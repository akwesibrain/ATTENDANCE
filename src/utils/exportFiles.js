/**
 * Small, dependency-free file writers for exports: CSV, Excel (.xlsx) and PDF.
 *
 * A "table" is { title, subtitle?, columns: [{ label, money?, number? }], rows: [[...]], totals?: [...] }.
 * Money columns hold numbers (GH₵); writers format them per file type.
 */

/* ------------------------------------------------------------------ CSV */

export function tablesToCsv(tables) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const cell = (v, col) => (col?.money && typeof v === 'number' ? v.toFixed(2) : v)
  const parts = tables.map((t) => {
    const lines = [[t.title], ...(t.subtitle ? [[t.subtitle]] : []), t.columns.map((c) => c.label)]
    t.rows.forEach((r) => lines.push(r.map((v, i) => cell(v, t.columns[i]))))
    if (t.totals) lines.push(t.totals.map((v, i) => cell(v, t.columns[i])))
    return lines.map((l) => l.map(q).join(',')).join('\r\n')
  })
  // BOM so Excel opens UTF-8 (GH₵) correctly.
  return `﻿${parts.join('\r\n\r\n')}`
}

/* ----------------------------------------------------------------- XLSX */

const enc = new TextEncoder()

let crcTable = null
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A ZIP archive with stored (uncompressed) entries. */
export function zipStore(files) {
  const chunks = []
  const central = []
  let offset = 0
  files.forEach(({ name, data }) => {
    const nameBytes = enc.encode(name)
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    const crc = crc32(bytes)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, 0, true)
    local.setUint16(12, 0x21, true) // 1980-01-01
    local.setUint32(14, crc, true)
    local.setUint32(18, bytes.length, true)
    local.setUint32(22, bytes.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    chunks.push(new Uint8Array(local.buffer), nameBytes, bytes)

    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, 0, true)
    c.setUint16(14, 0x21, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, bytes.length, true)
    c.setUint32(24, bytes.length, true)
    c.setUint16(28, nameBytes.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), nameBytes)
    offset += 30 + nameBytes.length + bytes.length
  })
  const centralSize = central.reduce((t, b) => t + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}

const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i) {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function sheetXml(t) {
  // Styles: 0 normal, 1 bold, 2 money, 3 bold money, 4 title.
  let r = 0
  const rowsXml = []
  const row = (cells) => {
    r += 1
    rowsXml.push(`<row r="${r}">${cells.map((c, i) => {
      if (c.value === null || c.value === undefined || c.value === '') return ''
      const ref = `${colName(i)}${r}`
      if (typeof c.value === 'number') return `<c r="${ref}" s="${c.s ?? 0}"><v>${c.value}</v></c>`
      return `<c r="${ref}" s="${c.s ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(c.value)}</t></is></c>`
    }).join('')}</row>`)
  }
  row([{ value: t.title, s: 4 }])
  if (t.subtitle) row([{ value: t.subtitle }])
  row([])
  row(t.columns.map((c) => ({ value: c.label, s: 1 })))
  t.rows.forEach((cells) => row(cells.map((v, i) => ({ value: v, s: t.columns[i]?.money ? 2 : 0 }))))
  if (t.totals) row(t.totals.map((v, i) => ({ value: v, s: t.columns[i]?.money ? 3 : 1 })))
  const widths = t.columns.map((c, i) => Math.min(48, Math.max(10, String(c.label).length + 2, ...t.rows.slice(0, 200).map((x) => String(x[i] ?? '').length + 2))))
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${t.subtitle ? 4 : 3}" topLeftCell="A${t.subtitle ? 5 : 4}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rowsXml.join('')}</sheetData></worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;GH₵&quot;#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B3D91"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`

/** One worksheet per table. Sheet names are trimmed to Excel's 31-character limit. */
export function tablesToXlsx(tables) {
  const names = tables.map((t, i) => (t.sheet ?? t.title).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`)
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...tables.map((t, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(t) })),
  ]
  const zip = zipStore(files)
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/* ------------------------------------------------------------------ PDF */

// Helvetica advance widths (1/1000 em) for ASCII 32–126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
// WinAnsi codes for the few non-ASCII characters we print.
const WIN = { '·': [0xb7, 278], '–': [0x96, 556], '—': [0x97, 1000], '×': [0xd7, 584], '÷': [0xf7, 584], '’': [0x92, 222], '‘': [0x91, 222], '“': [0x93, 333], '”': [0x94, 333], '…': [0x85, 1000], '•': [0x95, 350], 'é': [0xe9, 556], 'É': [0xc9, 667] }
const CEDI = '₵'

function charWidth(ch, bold) {
  if (ch === CEDI) return 722
  const c = ch.charCodeAt(0)
  let w = c >= 32 && c <= 126 ? HELV[c - 32] : (WIN[ch]?.[1] ?? 556)
  if (bold && !(c >= 48 && c <= 57)) w = Math.round(w * 1.06)
  return w
}

export function textWidth(str, size, bold = false) {
  let w = 0
  for (const ch of String(str)) w += charWidth(ch, bold)
  return (w * size) / 1000
}

function pdfString(str) {
  let out = ''
  for (const ch of str) {
    const c = ch.charCodeAt(0)
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`
    else if (c >= 32 && c <= 126) out += ch
    else if (WIN[ch]) out += `\\${WIN[ch][0].toString(8).padStart(3, '0')}`
    else out += '?'
  }
  return out
}

const rgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ')
}

/**
 * Tiny PDF builder: A4 pages, Helvetica/Helvetica-Bold, text, lines and boxes.
 * Coordinates are from the TOP-left in points (converted internally).
 */
export function createPdf({ landscape = false } = {}) {
  const W = landscape ? 842 : 595
  const H = landscape ? 595 : 842
  const pages = []
  let ops = null

  const api = {
    width: W,
    height: H,
    addPage() {
      ops = []
      pages.push(ops)
      return api
    },
    text(x, y, str, { size = 10, bold = false, color = '#14213d', align = 'left' } = {}) {
      const s = String(str ?? '')
      const w = textWidth(s, size, bold)
      let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
      const by = H - y
      ops.push(`${rgb(color)} rg`)
      // Split around ₵, which Helvetica lacks: draw "C" plus a vertical stroke.
      s.split(CEDI).forEach((part, i, arr) => {
        if (part) {
          ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${cx.toFixed(2)} ${by.toFixed(2)} Td (${pdfString(part)}) Tj ET`)
          cx += textWidth(part, size, bold)
        }
        if (i < arr.length - 1) {
          ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${cx.toFixed(2)} ${by.toFixed(2)} Td (C) Tj ET`)
          const mid = cx + (0.722 * size) / 2 + 0.2
          ops.push(`${rgb(color)} RG ${(size * (bold ? 0.09 : 0.065)).toFixed(2)} w ${mid.toFixed(2)} ${(by - size * 0.14).toFixed(2)} m ${mid.toFixed(2)} ${(by + size * 0.84).toFixed(2)} l S`)
          cx += (0.722 * size) * (bold ? 1.06 : 1)
        }
      })
      return api
    },
    line(x1, y1, x2, y2, { color = '#c9d6ea', width = 0.6 } = {}) {
      ops.push(`${rgb(color)} RG ${width} w ${x1} ${H - y1} m ${x2} ${H - y2} l S`)
      return api
    },
    rect(x, y, w, h, { fill = '#eef4ff', stroke = null } = {}) {
      ops.push(`${rgb(fill)} rg${stroke ? ` ${rgb(stroke)} RG 0.6 w` : ''} ${x} ${H - y - h} ${w} ${h} re ${stroke ? 'B' : 'f'}`)
      return api
    },
    /** Truncate text to fit a width. */
    fit(str, maxWidth, size, bold = false) {
      let s = String(str ?? '')
      if (textWidth(s, size, bold) <= maxWidth) return s
      while (s.length > 1 && textWidth(`${s}…`, size, bold) > maxWidth) s = s.slice(0, -1)
      return `${s}…`
    },
    toBlob() {
      const objects = []
      const add = (body) => { objects.push(body); return objects.length }
      const catalog = add(null)
      const pagesObj = add(null)
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
      const kids = pages.map((p) => {
        const stream = p.join('\n')
        const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
        return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`)
      })
      objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
      objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
      // Content is pure 7-bit text (non-ASCII is escaped), so string length = byte length.
      let out = '%PDF-1.4\n'
      const offsets = []
      objects.forEach((body, i) => {
        offsets.push(out.length)
        out += `${i + 1} 0 obj\n${body}\nendobj\n`
      })
      const xref = out.length
      out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
      out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`
      return new Blob([out], { type: 'application/pdf' })
    },
  }
  return api
}

const cedis = (n) => `GH₵${(Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Tables as a landscape PDF report, paginated, with repeated headers. */
export function tablesToPdf(tables, { heading = '' } = {}) {
  const pdf = createPdf({ landscape: true })
  const M = 32
  const usable = pdf.width - M * 2
  let y = 0
  const newPage = () => {
    pdf.addPage()
    pdf.rect(0, 0, pdf.width, 6, { fill: '#1864cc' })
    if (heading) pdf.text(M, 26, heading, { size: 9, color: '#5b6b86' })
    y = 44
  }
  newPage()
  tables.forEach((t, ti) => {
    if (ti > 0 && y > pdf.height - 120) newPage()
    else if (ti > 0) y += 18
    pdf.text(M, y, t.title, { size: 14, bold: true, color: '#0b3d91' })
    y += 14
    if (t.subtitle) { pdf.text(M, y, t.subtitle, { size: 9, color: '#5b6b86' }); y += 14 }
    // Column widths: proportional to content, money columns at least 64pt.
    const size = t.columns.length > 12 ? 6.6 : t.columns.length > 8 ? 7.6 : 8.6
    const fmt = (v, c) => (c.money && typeof v === 'number' ? cedis(v) : String(v ?? ''))
    const want = t.columns.map((c, i) => Math.max(textWidth(c.label, size, true), ...t.rows.slice(0, 80).map((r) => textWidth(fmt(r[i], c), size)), c.money ? 52 : 24) + 8)
    const scale = Math.min(1, usable / want.reduce((a, b) => a + b, 0))
    const widths = want.map((w) => w * scale)
    const xs = widths.reduce((acc, w, i) => [...acc, acc[i] + w], [M])
    const header = () => {
      pdf.rect(M, y - 2, usable, 15, { fill: '#e8f0fc' })
      t.columns.forEach((c, i) => {
        const right = c.money || c.number
        pdf.text(right ? xs[i + 1] - 4 : xs[i] + 4, y + 9, pdf.fit(c.label, widths[i] - 6, size, true), { size, bold: true, color: '#0b2558', align: right ? 'right' : 'left' })
      })
      y += 17
    }
    header()
    const rowsAll = t.totals ? [...t.rows, { totals: t.totals }] : t.rows
    rowsAll.forEach((r) => {
      const cells = Array.isArray(r) ? r : r.totals
      const bold = !Array.isArray(r)
      if (y > pdf.height - 36) { newPage(); header() }
      if (bold) pdf.line(M, y - 3, M + usable, y - 3, { color: '#0b3d91', width: 0.8 })
      cells.forEach((v, i) => {
        const c = t.columns[i]
        const right = c.money || c.number
        pdf.text(right ? xs[i + 1] - 4 : xs[i] + 4, y + 7, pdf.fit(fmt(v, c), widths[i] - 6, size, bold), { size, bold, align: right ? 'right' : 'left' })
      })
      y += 13
      if (!bold) pdf.line(M, y - 3, M + usable, y - 3, { color: '#edf1f7', width: 0.4 })
    })
  })
  return pdf.toBlob()
}

/** Hand a Blob to the browser as a download. */
export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
