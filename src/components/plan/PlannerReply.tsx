import { Text, View } from '@tarojs/components'
import './PlannerReply.scss'

interface ReplyBlock {
  kind: 'paragraph' | 'heading' | 'list' | 'code'
  text: string
  marker?: string
  depth?: number
  language?: string
  literal?: boolean
}

/** A small Markdown subset. Unsupported syntax remains visible as ordinary text. */
export function parseReplyBlocks(content: string): ReplyBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReplyBlock[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) { flush(); continue }

    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
      let end = index + 1
      while (end < lines.length && !closing.test(lines[end])) end += 1
      if (end < lines.length) {
        flush()
        blocks.push({ kind: 'code', text: lines.slice(index + 1, end).join('\n'), language: fence[2].trim() })
        index = end
        continue
      }
      // An unfinished fence is displayed literally, including its contents.
      flush()
      blocks.push({ kind: 'paragraph', text: lines.slice(index).join('\n'), literal: true })
      break
    }

    const heading = line.match(/^ {0,3}#{1,6}[ \t]+(.+)$/)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', text: heading[1].replace(/[ \t]+#+[ \t]*$/, '') })
      continue
    }

    const list = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/)
    if (list) {
      flush()
      blocks.push({ kind: 'list', text: list[3], marker: /^\d/.test(list[2]) ? list[2] : '•', depth: Math.min(3, Math.floor(list[1].replace(/\t/g, '  ').length / 2)) })
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks
}

function inlineContent(content: string) {
  // Only Text children are created: source HTML, scripts and URLs never execute.
  const pattern = /\\([\\`*_])|(`+)([^`]+?)\2|\*\*([^\n]+?)\*\*|__([^\n]+?)__/g
  const fragments: Array<string | JSX.Element> = []
  let offset = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > offset) fragments.push(content.slice(offset, match.index))
    if (match[1]) fragments.push(match[1])
    else if (match[2]) fragments.push(<Text key={match.index} className='planner-reply__inline-code'>{match[3]}</Text>)
    else fragments.push(<Text key={match.index} className='planner-reply__strong'>{match[4] ?? match[5]}</Text>)
    offset = pattern.lastIndex
  }
  if (offset < content.length) fragments.push(content.slice(offset))
  return fragments
}

/** Native Taro text works in both the web preview and the WeChat mini program. */
export default function PlannerReply({ content, className = '' }: { content: string; className?: string }) {
  return <View className={`planner-reply${className ? ` ${className}` : ''}`}>
    {parseReplyBlocks(content).map((block, index) => {
      if (block.kind === 'list') return <View key={index} className={`planner-reply__list planner-reply__list--depth-${block.depth}`}>
        <Text className='planner-reply__marker'>{block.marker}</Text>
        <Text className='planner-reply__list-text' selectable>{inlineContent(block.text)}</Text>
      </View>
      if (block.kind === 'code') return <View key={index} className='planner-reply__code'>
        {block.language && <Text className='planner-reply__code-language'>{block.language}</Text>}
        <Text className='planner-reply__code-text' selectable>{block.text}</Text>
      </View>
      return <Text key={index} className={`planner-reply__${block.kind}`} selectable>{block.literal ? block.text : inlineContent(block.text)}</Text>
    })}
  </View>
}
