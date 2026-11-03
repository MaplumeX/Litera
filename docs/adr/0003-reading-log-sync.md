# Reading logs sync as one object per device, outside the Manifest

Reading stats total time across devices, so each device's Reading log has to reach the others. The log only ever grows, while the Manifest is rewritten whole on every Sync, so we keep it out of the Manifest: each device writes `litera/stats/<deviceId>.json`, downloads the other devices' objects found by listing the prefix, and adds the logs up when stats are shown. Only a log's own device writes it, so there is nothing to merge and no conflict to resolve.

## Consequences

- Plaintext, like everything else on the Sync Backend (ADR 0001). A timeline of when and what someone read is more private than a shelf, so the first-enable disclosure names it, and a reader whose first upload comes after updating gets a one-time notice pointing at the setting that turns recording off.
- Turning recording off stops new data being uploaded. What is already on the Sync Backend stays; clearing it is not offered yet.
- Book deletion does not touch logs, and Tombstones do not apply to them: a deleted Book's time stays in the totals, labelled by the title kept in the log.
- A device that loses its data directory gets a new device id. Its old object stays on the Sync Backend and arrives as another device's log, so its time is kept.
- A log failing to sync never fails a Sync pass; the next pass tries again.
- What a device knows about these objects lives in `reading-log-sync.json`, not `sync-state.json`, whose parser rejects unknown fields, so a new field there would break an older build after a downgrade. It is reset when the Sync Backend changes, like other per-object state.
