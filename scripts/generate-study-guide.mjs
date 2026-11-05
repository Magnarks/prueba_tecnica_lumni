import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'

const root = process.cwd()
const sourcePath = path.join(root, 'docs', 'guia-estudio.md')
const outputPath = path.join(root, 'docs', 'guia-estudio.pdf')
const markdown = fs.readFileSync(sourcePath, 'utf8')
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 66, right: 56, bottom: 58, left: 56 },
  bufferPages: true,
  info: {
    Title: 'Guía de estudio - Lumni Coworking',
    Author: 'Lumni Coworking',
    Subject: 'Arquitectura y flujos de la prueba técnica Full Stack',
  },
})
const output = fs.createWriteStream(outputPath)

doc.pipe(output)

function drawHeader() {
  const { width, margins } = doc.page
  doc.save()
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#174b40')
    .text('LUMNI COWORKING  /  GUÍA DE ESTUDIO', margins.left, 24, {
      width: width - margins.left - margins.right,
      characterSpacing: 0.6,
    })
  doc.moveTo(margins.left, 43).lineTo(width - margins.right, 43)
    .lineWidth(0.7).strokeColor('#dce4dd').stroke()
  doc.restore()
  doc.y = margins.top
}

doc.on('pageAdded', drawHeader)
drawHeader()

function cleanInline(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<((?:https?:\/\/)[^>]+)>/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim()
}

function ensureSpace(height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
  }
}

function addHeading(text, level) {
  const style = level === 1
    ? { size: 25, color: '#174b40', font: 'Helvetica-Bold', before: 12, after: 12 }
    : level === 2
      ? { size: 16, color: '#174b40', font: 'Helvetica-Bold', before: 18, after: 8 }
      : { size: 11, color: '#b9523c', font: 'Helvetica-Bold', before: 10, after: 5 }

  ensureSpace(style.size + style.before + style.after + 12)
  doc.moveDown(style.before / 10)
  doc.font(style.font).fontSize(style.size).fillColor(style.color)
    .text(cleanInline(text), { lineGap: 2 })

  if (level === 1) {
    const y = doc.y + 6
    doc.moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(2).strokeColor('#e66c51').stroke()
    doc.y = y + 9
  } else {
    doc.moveDown(style.after / 10)
  }
}

function addParagraph(text) {
  const cleaned = cleanInline(text)
  const height = doc.heightOfString(cleaned, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    font: 'Helvetica',
    fontSize: 9.5,
    lineGap: 3,
  })
  ensureSpace(height + 10)
  doc.font('Helvetica').fontSize(9.5).fillColor('#263b32')
    .text(cleaned, { lineGap: 3, paragraphGap: 4 })
  doc.moveDown(0.35)
}

function addListItem(text, marker) {
  const cleaned = cleanInline(text)
  const content = `${marker} ${cleaned}`
  const height = doc.heightOfString(content, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 18,
    font: 'Helvetica',
    fontSize: 9.5,
    lineGap: 2.5,
  })
  ensureSpace(height + 4)
  doc.font('Helvetica').fontSize(9.5).fillColor('#263b32')
    .text(content, { indent: 10, hanging: 3, lineGap: 2.5 })
  doc.moveDown(0.18)
}

function addCallout(text) {
  const cleaned = cleanInline(text)
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const height = doc.heightOfString(cleaned, {
    width: width - 24,
    font: 'Helvetica',
    fontSize: 9.5,
    lineGap: 3,
  }) + 18
  ensureSpace(height + 8)
  const y = doc.y
  doc.save()
  doc.roundedRect(doc.page.margins.left, y, width, height, 4)
    .fillAndStroke('#edf4ee', '#d5e4d8')
  doc.restore()
  doc.font('Helvetica').fontSize(9.5).fillColor('#285444')
    .text(cleaned, doc.page.margins.left + 12, y + 9, {
      width: width - 24,
      lineGap: 3,
    })
  doc.y = y + height + 8
}

function addCodeBlock(lines) {
  const content = lines.join('\n')
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const height = doc.heightOfString(content, {
    width: width - 20,
    font: 'Courier',
    fontSize: 8,
    lineGap: 2,
  }) + 18
  ensureSpace(height + 8)
  const y = doc.y
  doc.save()
  doc.roundedRect(doc.page.margins.left, y, width, height, 4)
    .fillAndStroke('#f2f5f2', '#dfe6df')
  doc.restore()
  doc.font('Courier').fontSize(8).fillColor('#30453b')
    .text(content, doc.page.margins.left + 10, y + 9, {
      width: width - 20,
      lineGap: 2,
    })
  doc.y = y + height + 8
}

function addTable(lines) {
  const rows = lines
    .filter((line) => !/^\|\s*:?-{2,}/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cleanInline(cell)))
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const rowHeight = 24
  ensureSpace(rows.length * rowHeight + 10)

  for (const [index, cells] of rows.entries()) {
    const y = doc.y
    doc.save()
    doc.rect(doc.page.margins.left, y, width, rowHeight)
      .fillAndStroke(index === 0 ? '#eaf1eb' : (index % 2 ? '#ffffff' : '#f7f9f7'), '#dce4dd')
    doc.restore()

    const cellWidth = width / cells.length
    cells.forEach((cell, cellIndex) => {
      doc.font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.5)
        .fillColor(index === 0 ? '#174b40' : '#263b32')
        .text(cell, doc.page.margins.left + cellIndex * cellWidth + 7, y + 7, {
          width: cellWidth - 14,
          height: rowHeight - 10,
          ellipsis: true,
        })
    })
    doc.y = y + rowHeight
  }

  doc.moveDown(0.45)
}

const lines = markdown.split(/\r?\n/)
let inCode = false
let codeLines = []

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]

  if (line.startsWith('```')) {
    if (inCode) {
      addCodeBlock(codeLines)
      codeLines = []
      inCode = false
    } else {
      inCode = true
    }
    continue
  }

  if (inCode) {
    codeLines.push(line)
    continue
  }

  if (!line.trim()) {
    doc.moveDown(0.25)
    continue
  }

  const heading = /^(#{1,3})\s+(.+)$/.exec(line)
  if (heading) {
    addHeading(heading[2], heading[1].length)
    continue
  }

  if (line.startsWith('|')) {
    const tableLines = []
    while (index < lines.length && lines[index].startsWith('|')) {
      tableLines.push(lines[index])
      index += 1
    }
    index -= 1
    addTable(tableLines)
    continue
  }

  if (line.startsWith('> ')) {
    addCallout(line.slice(2))
    continue
  }

  const numberedItem = /^(\d+\.)\s+(.+)$/.exec(line)
  if (numberedItem) {
    addListItem(numberedItem[2], numberedItem[1])
    continue
  }

  if (/^[-*]\s+/.test(line)) {
    addListItem(line.replace(/^[-*]\s+/, ''), '-')
    continue
  }

  addParagraph(line)
}

if (inCode && codeLines.length) {
  addCodeBlock(codeLines)
}

const pageRange = doc.bufferedPageRange()
for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
  doc.switchToPage(index)
  doc.font('Helvetica').fontSize(8).fillColor('#7a8980')
    .text(`Página ${index - pageRange.start + 1} de ${pageRange.count}`, 0, doc.page.height - 70, {
      align: 'center',
      width: doc.page.width,
      lineBreak: false,
    })
}

doc.end()
await new Promise((resolve, reject) => {
  output.on('finish', resolve)
  output.on('error', reject)
})

console.log(`PDF generado: ${path.relative(root, outputPath)} (${pageRange.count} páginas)`)