import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-3xl font-bold">Litera</h1>
      <p className="text-muted-foreground">Agent-Enhanced EPUB Reader</p>

      {/* Tailwind CSS verification */}
      <div className="rounded-lg bg-blue-500 px-4 py-2 text-white">
        Tailwind CSS works — this div has bg-blue-500
      </div>

      {/* shadcn/ui Button verification */}
      <Button variant="default">shadcn Button</Button>
    </main>
  );
}

export default App;