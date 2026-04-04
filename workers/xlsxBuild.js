'use strict';
/**
 * Worker thread: builds an XLSX workbook from pre-fetched bug data.
 * Runs off the main event loop so CPU-intensive XLSX generation
 * never blocks request handling.
 *
 * workerData shape:
 *   projects : Array<{ projectName: string, bugs: Bug[] }>
 *   userMap  : Record<userId, userName>
 *   headers  : string[]
 */

const { workerData, parentPort } = require('worker_threads');

let XLSX;
try {
  XLSX = require('xlsx');
} catch {
  parentPort.postMessage({ ok: false, error: 'xlsx package not found — run: npm install xlsx' });
  process.exit(1);
}

function getMetaValue(description, label) {
  const prefix = `${label}:`;
  const line = String(description || '').split('\n').find(l => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

try {
  const { projects, userMap, headers } = workerData;
  const wb = XLSX.utils.book_new();

  for (const { projectName, bugs } of projects) {
    const rows = [headers];
    bugs.forEach((bug, idx) => {
      rows.push([
        idx + 1,
        bug.title        || '',
        bug.status       || '',
        bug.priority     || '',
        userMap[String(bug.assignee_id)] || '',
        bug.type         || '',
        getMetaValue(bug.description, 'Module'),
        getMetaValue(bug.description, 'Feature'),
        userMap[String(bug.reporter_id)] || getMetaValue(bug.description, 'Raised By'),
        bug.created_at ? new Date(bug.created_at).toLocaleDateString('en-GB') : '',
        getMetaValue(bug.description, 'Developer Comments'),
        getMetaValue(bug.description, 'QA Comments'),
        getMetaValue(bug.description, 'Sprint'),
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6  }, { wch: 60 }, { wch: 14 }, { wch: 12 },
      { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 20 },
      { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 30 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, projectName);
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'Issues');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  // Transfer the underlying ArrayBuffer (zero-copy) back to the main thread
  parentPort.postMessage({ ok: true, buffer }, [buffer.buffer]);

} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
