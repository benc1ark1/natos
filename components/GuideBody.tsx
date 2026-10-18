import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Renders a guide's text. Small, safe subset (no HTML is ever injected):
 *   ## Heading   ### Subheading   ---   > quote
 *   - bullet     1. numbered      | table | row |  (first row = header)
 *   **bold**  *italic*  [[Guide title]] = link to that guide
 * Lines next to each other form one paragraph; a blank line starts a new one.
 */
export default function GuideBody({ text, links }: { text: string; links: Map<string, string> }) {
  const out: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  const inline = (s: string) => renderInline(s, links)

  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    const key = out.length
    if (!t) { i++; continue }
    if (t === '---') { out.push(<hr key={key} />); i++; continue }
    if (t.startsWith('### ')) { out.push(<h3 key={key}>{inline(t.slice(4))}</h3>); i++; continue }
    if (t.startsWith('## ') || t.startsWith('# ')) { out.push(<h2 key={key}>{inline(t.replace(/^#+ /, ''))}</h2>); i++; continue }
    if (t.startsWith('|')) {
      const rowsOf: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rowsOf.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
        i++
      }
      const [head, ...body] = rowsOf
      out.push(
        <div className="gtable" key={key}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^[-*] /.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) { items.push(lines[i].trim().slice(2)); i++ }
      out.push(<ul key={key}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>)
      continue
    }
    if (/^\d+\. /.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+\. /, '')); i++ }
      out.push(<ol key={key}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>)
      continue
    }
    if (t.startsWith('>')) {
      const parts: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { parts.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
      out.push(<blockquote key={key}>{joinLines(parts.filter(Boolean), inline)}</blockquote>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i].trim())) { para.push(lines[i].trim()); i++ }
    out.push(<p key={key}>{joinLines(para, inline)}</p>)
  }
  return <div className="gbody">{out}</div>
}

const isBlockStart = (t: string) =>
  t === '---' || t.startsWith('#') || t.startsWith('|') || t.startsWith('>') || /^[-*] /.test(t) || /^\d+\. /.test(t)

function joinLines(parts: string[], inline: (s: string) => ReactNode) {
  return parts.map((p, j) => <span key={j}>{j > 0 && <br />}{inline(p)}</span>)
}

function renderInline(s: string, links: Map<string, string>): ReactNode {
  const pieces = s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[\[[^\]]+\]\])/g)
  return pieces.map((p, j) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={j}>{p.slice(2, -2)}</strong>
    if (p.startsWith('[[') && p.endsWith(']]')) {
      const title = p.slice(2, -2).trim()
      const id = links.get(title.toLowerCase())
      return id ? <Link key={j} className="gref" href={`/guides/${id}`}>{title}</Link> : <span key={j}>{title}</span>
    }
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={j}>{p.slice(1, -1)}</em>
    return p
  })
}
