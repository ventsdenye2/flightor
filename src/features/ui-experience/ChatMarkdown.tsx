import { memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import { Lexer } from 'marked'
import type { MarkedToken, Token, Tokens } from 'marked'
import { decodeHTML } from 'entities'
import { MarkdownLink } from './MarkdownLink'

type OpenSource = ((url: string) => void) | undefined

// Use the parser's token tree, never generated HTML, on both platforms.
function inline(tokens: Token[], onOpenSource: OpenSource): ReactNode {
  return tokens.map((value, index) => {
    const token = value as MarkedToken
    switch (token.type) {
      case 'strong': case 'em': case 'del':
        return <Text key={index} className={`pl-md-${token.type}`}>{inline(token.tokens, onOpenSource)}</Text>
      case 'codespan':
        return <Text key={index} className='pl-md-inline-code'>{token.text}</Text>
      case 'br': return <Text key={index}>{'\n'}</Text>
      // The task marker is already rendered in the list's marker column.
      case 'checkbox': return null
      case 'link': {
        const href = (token.autolink ? token.href : decodeHTML(token.href)).trim()
        const label = inline(token.tokens, onOpenSource)
        return /^https?:\/\//i.test(href) && !/[\u0000-\u0020\u007f]/.test(href)
          ? <MarkdownLink key={index} href={href} onOpenSource={onOpenSource}>{label}</MarkdownLink>
          : <Text key={index}>{label}</Text>
      }
      case 'image': return <Text key={index}>{decodeHTML(token.text || '图片')}</Text>
      case 'text':
        return <Text key={index}>{token.tokens ? inline(token.tokens, onOpenSource) : decodeHTML(token.text)}</Text>
      case 'escape': return <Text key={index}>{token.text}</Text>
      case 'html': return <Text key={index}>{token.text}</Text>
      default: return <Text key={index}>{token.raw}</Text>
    }
  })
}

function table(token: Tokens.Table, onOpenSource: OpenSource) {
  return <ScrollView className='pl-md-table-scroll' scrollX>
    <View className='pl-md-table' style={{ minWidth: `${token.header.length * 140}px` }}>
      {[token.header, ...token.rows].map((row, rowIndex) => <View key={rowIndex} className={`pl-md-table-row${rowIndex === 0 ? ' pl-md-table-head' : ''}`}>
        {row.map((cell, cellIndex) => <View key={cellIndex} className='pl-md-table-cell' style={{ textAlign: cell.align || 'left' }}><Text>{inline(cell.tokens, onOpenSource)}</Text></View>)}
      </View>)}
    </View>
  </ScrollView>
}

function blocks(tokens: Token[], onOpenSource: OpenSource): ReactNode {
  return tokens.map((value, index) => {
    const token = value as MarkedToken
    let content: ReactNode
    switch (token.type) {
      case 'space': case 'def': return null
      case 'heading':
        content = <View className={`pl-md-heading pl-md-h${token.depth}`}><Text>{inline(token.tokens, onOpenSource)}</Text></View>
        break
      case 'paragraph': case 'text':
        content = <View className='pl-md-paragraph'><Text>{token.tokens ? inline(token.tokens, onOpenSource) : decodeHTML(token.text)}</Text></View>
        break
      case 'blockquote': content = <View className='pl-md-quote'>{blocks(token.tokens, onOpenSource)}</View>; break
      case 'list':
        content = <View className='pl-md-list'>{token.items.map((item, itemIndex) => <View key={itemIndex} className='pl-md-list-item'>
          <Text className={`pl-md-list-marker${item.task ? ' pl-md-task' : ''}`}>{item.task ? (item.checked ? '☑' : '☐') : token.ordered ? `${Number(token.start || 1) + itemIndex}.` : '•'}</Text>
          <View className='pl-md-list-body'>{blocks(item.tokens, onOpenSource)}</View>
        </View>)}</View>
        break
      case 'code':
        content = <View className='pl-md-code-block'>{token.lang ? <Text className='pl-md-code-language'>{token.lang}</Text> : null}<Text className='pl-md-code' selectable>{token.text}</Text></View>
        break
      case 'table': content = table(token, onOpenSource); break
      case 'hr': content = <View className='pl-md-divider' />; break
      case 'html': content = <View className='pl-md-paragraph'><Text>{token.text}</Text></View>; break
      default: content = <View className='pl-md-paragraph'><Text>{inline([token], onOpenSource)}</Text></View>
    }
    return <View key={index} className='pl-md-block'>{content}</View>
  })
}

export const ChatMarkdown = memo(function ChatMarkdown({ content, onOpenSource }: { content: string; onOpenSource?: (url: string) => void }) {
  const tokens = useMemo(() => Lexer.lex(content, { gfm: true, breaks: true }), [content])
  return <View className='pl-markdown'>{blocks(tokens, onOpenSource)}</View>
})
