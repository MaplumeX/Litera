/// Windows COM Thumbnail Provider for Litera
///
/// Implements `IThumbnailProvider` and `IInitializeWithItem` for Windows Shell
/// integration.  This allows Windows Explorer to show EPUB book covers as file
/// thumbnails when Litera is the default application for `.epub`.
///
/// ## CLSID: {A2A296FA-9317-44A3-A371-6A883CAA1F33}
///
/// Registry entries are written to `HKCU\Software\Classes` (current-user) so
/// that the NSIS `currentUser` installer does not require administrator rights.
use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};

use windows::core::{IUnknown, Interface, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG,
    E_NOINTERFACE, HMODULE, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{CoTaskMemFree, IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::Win32::UI::Shell::{
    AssocQueryStringW, IInitializeWithItem, IInitializeWithItem_Impl, IShellItem,
    IThumbnailProvider, IThumbnailProvider_Impl, ASSOCF_NONE, ASSOCSTR_EXECUTABLE,
    SIGDN_FILESYSPATH, WTSAT_ARGB, WTS_ALPHATYPE,
};
use windows_core::BOOL;
use windows_core::{implement, Ref};

use super::cached_thumbnail_for_path;

// ─────────────────────────────────────────────────────────────────────────────
// CLSID for Litera Thumbnail Provider
// ─────────────────────────────────────────────────────────────────────────────

/// CLSID: {A2A296FA-9317-44A3-A371-6A883CAA1F33}
pub const CLSID_LITERA_THUMBNAIL: GUID =
    GUID::from_u128(0xA2A296FA_9317_44A3_A371_6A883CAA1F33);

/// Supported file extensions (EPUB only — Litera is an EPUB reader).
pub const SUPPORTED_EXTENSIONS: &[&str] = &[".epub"];

// DLL reference counting
static DLL_REF_COUNT: AtomicU32 = AtomicU32::new(0);
static DLL_MODULE_PTR: AtomicIsize = AtomicIsize::new(0);

fn dll_add_ref() {
    DLL_REF_COUNT.fetch_add(1, Ordering::SeqCst);
}
fn dll_release() {
    DLL_REF_COUNT.fetch_sub(1, Ordering::SeqCst);
}

fn set_dll_module(h: HMODULE) {
    DLL_MODULE_PTR.store(h.0 as isize, Ordering::SeqCst);
}

fn get_dll_module() -> Option<HMODULE> {
    let ptr = DLL_MODULE_PTR.load(Ordering::SeqCst);
    if ptr == 0 {
        None
    } else {
        Some(HMODULE(ptr as *mut c_void))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// File Association Check
// ─────────────────────────────────────────────────────────────────────────────

/// Check if Litera is the default application for a given file extension.
fn is_litera_default_for_extension(ext: &str) -> bool {
    let ext_wide: Vec<u16> = ext.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buffer = [0u16; 260];
    let mut buffer_size = buffer.len() as u32;

    unsafe {
        let result = AssocQueryStringW(
            ASSOCF_NONE,
            ASSOCSTR_EXECUTABLE,
            PCWSTR(ext_wide.as_ptr()),
            None,
            Some(PWSTR(buffer.as_mut_ptr())),
            &mut buffer_size,
        );

        if result.is_ok() {
            let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
            let path = String::from_utf16_lossy(&buffer[..len]).to_lowercase();
            return path.contains("litera");
        }
    }

    false
}

/// Check if Litera is the default app for a specific file path.
fn is_litera_default_for_file(path: &PathBuf) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_with_dot = format!(".{}", ext.to_lowercase());
        return is_litera_default_for_extension(&ext_with_dot);
    }
    false
}

// ─────────────────────────────────────────────────────────────────────────────
// ThumbnailProvider
// ─────────────────────────────────────────────────────────────────────────────

/// Interior mutability wrapper for COM single-threaded apartment.
struct ComCell<T>(UnsafeCell<T>);

impl<T> ComCell<T> {
    fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }
    fn get(&self) -> &T {
        unsafe { &*self.0.get() }
    }
    fn set(&self, value: T) {
        unsafe {
            *self.0.get() = value;
        }
    }
}

// SAFETY: COM thumbnail providers run in single-threaded apartment (STA).
unsafe impl<T> Sync for ComCell<T> {}
unsafe impl<T> Send for ComCell<T> {}

#[implement(IThumbnailProvider, IInitializeWithItem)]
pub struct ThumbnailProvider {
    file_path: ComCell<Option<PathBuf>>,
    file_ext: ComCell<Option<String>>,
    should_provide: ComCell<bool>,
}

impl ThumbnailProvider {
    pub fn new() -> Self {
        dll_add_ref();
        Self {
            file_path: ComCell::new(None),
            file_ext: ComCell::new(None),
            should_provide: ComCell::new(false),
        }
    }
}

impl Default for ThumbnailProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ThumbnailProvider {
    fn drop(&mut self) {
        dll_release();
    }
}

impl IInitializeWithItem_Impl for ThumbnailProvider_Impl {
    fn Initialize(&self, psi: Ref<'_, IShellItem>, _grfmode: u32) -> windows::core::Result<()> {
        let item = psi.ok()?;

        unsafe {
            let path_pwstr = item.GetDisplayName(SIGDN_FILESYSPATH)?;

            let mut len = 0usize;
            let mut ptr = path_pwstr.0;
            while *ptr != 0 {
                len += 1;
                ptr = ptr.add(1);
            }

            let slice = std::slice::from_raw_parts(path_pwstr.0, len);
            let path_str = String::from_utf16_lossy(slice);
            let path = PathBuf::from(&path_str);

            CoTaskMemFree(Some(path_pwstr.0 as *const c_void));

            let is_default = is_litera_default_for_file(&path);
            self.should_provide.set(is_default);

            if !is_default {
                return Ok(());
            }

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();

            self.file_path.set(Some(path));
            self.file_ext.set(Some(ext));
        }
        Ok(())
    }
}

impl IThumbnailProvider_Impl for ThumbnailProvider_Impl {
    fn GetThumbnail(
        &self,
        cx: u32,
        phbmp: *mut HBITMAP,
        pdwalpha: *mut WTS_ALPHATYPE,
    ) -> windows::core::Result<()> {
        if !*self.should_provide.get() {
            return Err(E_FAIL.into());
        }

        let path = self.file_path.get().as_ref().ok_or(E_FAIL)?;
        let ext = self.file_ext.get().as_ref().ok_or(E_FAIL)?;

        let png_bytes = cached_thumbnail_for_path(path, ext, cx).map_err(|_| E_FAIL)?;
        let img = image::load_from_memory(&png_bytes).map_err(|_| E_FAIL)?;
        let rgba = img.to_rgba8();
        let (width, height) = (rgba.width(), rgba.height());

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut bits: *mut c_void = std::ptr::null_mut();

        unsafe {
            let hbmp = CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0)
                .map_err(|_| E_FAIL)?;
            if bits.is_null() {
                return Err(E_FAIL.into());
            }

            // RGBA -> BGRA
            let dst =
                std::slice::from_raw_parts_mut(bits as *mut u8, (width * height * 4) as usize);
            let src = rgba.as_raw();
            for i in 0..(width * height) as usize {
                let si = i * 4;
                dst[si] = src[si + 2]; // B
                dst[si + 1] = src[si + 1]; // G
                dst[si + 2] = src[si]; // R
                dst[si + 3] = src[si + 3]; // A
            }

            *phbmp = hbmp;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClassFactory
// ─────────────────────────────────────────────────────────────────────────────

#[implement(IClassFactory)]
pub struct ThumbnailProviderFactory;

impl ThumbnailProviderFactory {
    pub fn new() -> Self {
        dll_add_ref();
        Self
    }
}

impl Default for ThumbnailProviderFactory {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ThumbnailProviderFactory {
    fn drop(&mut self) {
        dll_release();
    }
}

impl IClassFactory_Impl for ThumbnailProviderFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        unsafe {
            if ppvobject.is_null() {
                return Err(E_INVALIDARG.into());
            }
            *ppvobject = std::ptr::null_mut();
            if !punkouter.is_null() {
                return Err(CLASS_E_NOAGGREGATION.into());
            }

            let provider: IThumbnailProvider = ThumbnailProvider::new().into();
            provider.query(&*riid, ppvobject).ok()
        }
    }

    fn LockServer(&self, flock: BOOL) -> windows::core::Result<()> {
        if flock.as_bool() {
            dll_add_ref();
        } else {
            dll_release();
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DLL Exports
// ─────────────────────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "system" fn DllMain(hinstance: HMODULE, reason: u32, _reserved: *mut c_void) -> BOOL {
    const DLL_PROCESS_ATTACH: u32 = 1;
    if reason == DLL_PROCESS_ATTACH {
        set_dll_module(hinstance);
    }
    BOOL::from(true)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if DLL_REF_COUNT.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if ppv.is_null() || rclsid.is_null() || riid.is_null() {
        return E_INVALIDARG;
    }
    *ppv = std::ptr::null_mut();

    if *rclsid != CLSID_LITERA_THUMBNAIL {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    if *riid != IClassFactory::IID && *riid != IUnknown::IID {
        return E_NOINTERFACE;
    }

    let factory: IClassFactory = ThumbnailProviderFactory::new().into();
    factory.query(&*riid, ppv)
}

#[no_mangle]
pub unsafe extern "system" fn DllRegisterServer() -> HRESULT {
    match register_server_impl() {
        Ok(()) => S_OK,
        Err(e) => e,
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllUnregisterServer() -> HRESULT {
    let _ = unregister_server_impl();
    S_OK
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry helpers
// ─────────────────────────────────────────────────────────────────────────────

fn get_dll_path() -> Option<String> {
    let module = get_dll_module()?;
    let mut buffer = [0u16; 260];
    unsafe {
        let len = GetModuleFileNameW(Some(module), &mut buffer);
        if len == 0 {
            None
        } else {
            Some(String::from_utf16_lossy(&buffer[..len as usize]))
        }
    }
}

fn clsid_string() -> String {
    format!(
        "{{{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
        CLSID_LITERA_THUMBNAIL.data1,
        CLSID_LITERA_THUMBNAIL.data2,
        CLSID_LITERA_THUMBNAIL.data3,
        CLSID_LITERA_THUMBNAIL.data4[0],
        CLSID_LITERA_THUMBNAIL.data4[1],
        CLSID_LITERA_THUMBNAIL.data4[2],
        CLSID_LITERA_THUMBNAIL.data4[3],
        CLSID_LITERA_THUMBNAIL.data4[4],
        CLSID_LITERA_THUMBNAIL.data4[5],
        CLSID_LITERA_THUMBNAIL.data4[6],
        CLSID_LITERA_THUMBNAIL.data4[7]
    )
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn set_reg_value(key: HKEY, name: &str, value: &str) -> Result<(), HRESULT> {
    let name_w = to_wide(name);
    let value_w = to_wide(value);
    let bytes: &[u8] = std::slice::from_raw_parts(value_w.as_ptr() as *const u8, value_w.len() * 2);
    if RegSetValueExW(key, PCWSTR(name_w.as_ptr()), Some(0), REG_SZ, Some(bytes)).is_err() {
        Err(E_FAIL)
    } else {
        Ok(())
    }
}

unsafe fn create_reg_key(parent: HKEY, subkey: &str) -> Result<HKEY, HRESULT> {
    let subkey_w = to_wide(subkey);
    let mut hkey = HKEY::default();
    let result = RegCreateKeyExW(
        parent,
        PCWSTR(subkey_w.as_ptr()),
        Some(0),
        None,
        REG_OPTION_NON_VOLATILE,
        KEY_WRITE,
        None,
        &mut hkey,
        None,
    );
    if result.is_err() {
        Err(E_FAIL)
    } else {
        Ok(hkey)
    }
}

/// Register the COM server under `HKCU\Software\Classes`.
///
/// Uses `HKEY_CURRENT_USER` instead of `HKEY_CLASSES_ROOT` so that the
/// NSIS `currentUser` installer does not need administrator rights.
unsafe fn register_server_impl() -> Result<(), HRESULT> {
    let dll_path = get_dll_path().ok_or(E_FAIL)?;
    let clsid = clsid_string();

    // CLSID key under HKCU\Software\Classes
    let clsid_key = create_reg_key(
        HKEY_CURRENT_USER,
        &format!("Software\\Classes\\CLSID\\{}", clsid),
    )?;
    set_reg_value(clsid_key, "", "Litera Thumbnail Provider")?;

    // DisableProcessIsolation = 1 — run inside the Explorer process.
    let disable_isolation_name = to_wide("DisableProcessIsolation");
    let value: u32 = 1;
    let _ = RegSetValueExW(
        clsid_key,
        PCWSTR(disable_isolation_name.as_ptr()),
        Some(0),
        windows::Win32::System::Registry::REG_DWORD,
        Some(std::slice::from_raw_parts(
            &value as *const u32 as *const u8,
            4,
        )),
    );

    let inproc_key = create_reg_key(clsid_key, "InprocServer32")?;
    set_reg_value(inproc_key, "", &dll_path)?;
    set_reg_value(inproc_key, "ThreadingModel", "Apartment")?;
    let _ = RegCloseKey(inproc_key);
    let _ = RegCloseKey(clsid_key);

    // Register ShellEx thumbnail handler for each supported extension.
    for ext in SUPPORTED_EXTENSIONS {
        let ext_shellex_path =
            format!("Software\\Classes\\{}\\ShellEx\\{{e357fccd-a995-4576-b01f-234630154e96}}", ext);
        if let Ok(ext_shellex_key) = create_reg_key(HKEY_CURRENT_USER, &ext_shellex_path) {
            let _ = set_reg_value(ext_shellex_key, "", &clsid);
            let _ = RegCloseKey(ext_shellex_key);
        }
    }
    Ok(())
}

/// Unregister the COM server from `HKCU\Software\Classes`.
unsafe fn unregister_server_impl() -> Result<(), HRESULT> {
    let clsid = clsid_string();

    let clsid_path = to_wide(&format!("Software\\Classes\\CLSID\\{}", clsid));
    let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(clsid_path.as_ptr()));

    for ext in SUPPORTED_EXTENSIONS {
        let ext_path = to_wide(&format!(
            "Software\\Classes\\{}\\ShellEx\\{{e357fccd-a995-4576-b01f-234630154e96}}",
            ext
        ));
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(ext_path.as_ptr()));
    }
    Ok(())
}