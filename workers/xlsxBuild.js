'use strict';
/**
 * Worker thread: builds an XLSX workbook from pre-fetched bug data.
 * Runs off the main event loop so CPU-intensive XLSX generation
 * never blocks request handling.
 *
 * workerData shape:
 *   projects : Array<{ projectName: string, bugs: Bug[], sheetLayoutVersion?: string,
 *                      customIssueFields?: object[], sheetHeaders?: string[] }>
 *   userMap  : Record<userId, userName>
 *   legacyHeaders  : string[]
 *   compactHeaders : string[]
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

function resolveColumnValue(header, bug, userMap, index, createdDate) {
  const hl = String(header || '').trim().toLowerCase();
  if (/^(s\.?no\.?|#|sr\.?\s*no\.?|serial\s*no\.?|no\.)$/.test(hl)) return String(index + 1);
  if (/^(date|date created|entry date|created date|logged date|open date)$/.test(hl)) return createdDate;
  if (/^(raised by|issue raised by|raised date|reporter)$/.test(hl)) return userMap[String(bug.reporter_id)] || getMetaValue(bug.description, 'Raised By') || '';
  if (/^assignee$/.test(hl)) return userMap[String(bug.assignee_id)] || '';
  if (/^(issue description|issue title|title|description of bug|description)$/.test(hl)) return bug.title || '';
  if (/^status$/.test(hl)) return bug.status || '';
  if (/^priority$/.test(hl)) return bug.priority || '';
  if (/^(issue type|bug type|type)$/.test(hl)) return bug.type || '';
  if (/^module$/.test(hl)) return getMetaValue(bug.description, 'Module') || '';
  if (/^feature$/.test(hl)) return getMetaValue(bug.description, 'Feature') || '';
  if (/^(dev comments?|developer comments?)$/.test(hl)) return getMetaValue(bug.description, 'Developer Comments') || getMetaValue(bug.description, 'Dev Comments') || '';
  if (/^(qa comments?|qa comment)$/.test(hl)) return getMetaValue(bug.description, 'QA Comments') || '';
  if (/^sprint$/.test(hl)) return getMetaValue(bug.description, 'Sprint') || '';
  if (/^(location type|location)$/.test(hl)) return getMetaValue(bug.description, 'Location Type') || getMetaValue(bug.description, 'Location') || getMetaValue(bug.description, header) || '';
  if (/^(retail type|domain retail restaurant|org type)$/.test(hl)) return getMetaValue(bug.description, 'Retail Type') || '';
  if (/^(environment|envirnoment)$/.test(hl)) return getMetaValue(bug.description, 'Environment') || '';
  if (/^browser$/.test(hl)) return getMetaValue(bug.description, 'Browser') || '';
  if (/^(os|os operating system|operating system)$/.test(hl)) return getMetaValue(bug.description, 'Operating System') || '';
  if (/^(application|product)$/.test(hl)) return getMetaValue(bug.description, 'Application') || '';
  return getMetaValue(bug.description, String(header).trim()) || getMetaValue(bug.description, hl) || '';
}

try {
  const { projects, userMap, legacyHeaders, compactHeaders } = workerData;
  const wb = XLSX.utils.book_new();

  for (const { projectName, bugs, sheetLayoutVersion, customIssueFields = [], sheetHeaders = [] } of projects) {
    const useCompactLayout = sheetLayoutVersion === 'compact_v2';
    // For legacy projects: use stored sheet_headers if available to preserve column order
    const useDynamicHeaders = !useCompactLayout && sheetHeaders.length > 0;
    const headerRow = useCompactLayout
      ? [...compactHeaders, ...customIssueFields.map((field) => String(field?.label || '').trim()).filter(Boolean)]
      : useDynamicHeaders ? sheetHeaders : legacyHeaders;
    const rows = [headerRow];
    bugs.forEach((bug, idx) => {
      const raisedBy = userMap[String(bug.reporter_id)] || getMetaValue(bug.description, 'Raised By');
      const assignee = userMap[String(bug.assignee_id)] || '';
      const createdDate = bug.created_at ? new Date(bug.created_at).toLocaleDateString('en-GB') : '';
      const customValues = bug?.custom_fields && typeof bug.custom_fields === 'object' ? bug.custom_fields : {};
      if (useDynamicHeaders) {
        rows.push(sheetHeaders.map(h => resolveColumnValue(h, bug, userMap, idx, createdDate)));
      } else {
        rows.push(
          useCompactLayout
            ? [
                createdDate,
                bug.title || '',
                raisedBy,
                bug.type || '',
                assignee,
                bug.priority || '',
                bug.status || '',
                ...customIssueFields.map((field) => customValues[field.id] || ''),
              ]
            : [
                idx + 1,
                bug.title || '',
                bug.status || '',
                bug.priority || '',
                assignee,
                bug.type || '',
                getMetaValue(bug.description, 'Module'),
                getMetaValue(bug.description, 'Feature'),
                raisedBy,
                createdDate,
                getMetaValue(bug.description, 'Developer Comments'),
                getMetaValue(bug.description, 'QA Comments'),
                getMetaValue(bug.description, 'Sprint'),
              ]
        );
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = useCompactLayout
      ? [
          { wch: 14 }, { wch: 60 }, { wch: 20 }, { wch: 14 },
          { wch: 20 }, { wch: 12 }, { wch: 14 },
          ...customIssueFields.map(() => ({ wch: 18 })),
        ]
      : useDynamicHeaders
        ? sheetHeaders.map(() => ({ wch: 20 }))
        : [
            { wch: 6 }, { wch: 60 }, { wch: 14 }, { wch: 12 },
            { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 20 },
            { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 30 }, { wch: 14 },
          ];
    XLSX.utils.book_append_sheet(wb, ws, projectName);
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([legacyHeaders]), 'Issues');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  // Transfer the underlying ArrayBuffer (zero-copy) back to the main thread
  parentPort.postMessage({ ok: true, buffer }, [buffer.buffer]);

} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
