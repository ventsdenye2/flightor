import { Button, Text, View } from '@tarojs/components'
import type { CloudTripContextSummary } from '../../services/conversationService'
import {
  formatTripContextChips,
  type TripContextChipViewModel,
  type TripContextLocale
} from './tripContextChips'
import './TripContextChips.scss'

export interface TripContextChipsProps {
  /** The current server-returned summary; undefined/null intentionally renders the empty state. */
  summary?: CloudTripContextSummary | null
  locale: TripContextLocale
  /** Called with the display model only; this component never edits the summary. */
  onRemove?: (chip: TripContextChipViewModel) => void
  /** Opens the detailed Trip Context editor owned by the parent. */
  onEdit?: () => void
  title?: string
  emptyLabel?: string
}

const DEFAULT_TITLE: Record<TripContextLocale, string> = {
  zh: '当前行程',
  en: 'Current trip'
}

const DEFAULT_EMPTY_LABEL: Record<TripContextLocale, string> = {
  zh: '还没有已确认的行程信息',
  en: 'No trip details confirmed yet'
}

const EDIT_LABEL: Record<TripContextLocale, string> = {
  zh: '编辑',
  en: 'Edit'
}

export default function TripContextChips({
  summary,
  locale,
  onRemove,
  onEdit,
  title,
  emptyLabel
}: TripContextChipsProps) {
  const chips = formatTripContextChips(summary, locale)
  const resolvedTitle = title ?? DEFAULT_TITLE[locale]
  const resolvedEmptyLabel = emptyLabel ?? DEFAULT_EMPTY_LABEL[locale]
  const editLabel = EDIT_LABEL[locale]

  return (
    <View className='trip-context-chips' role='region' ariaLabel={resolvedTitle}>
      <View className='trip-context-chips__header'>
        <Text className='trip-context-chips__title'>{resolvedTitle}</Text>
        {onEdit && (
          <Button
            className='trip-context-chips__edit'
            plain
            ariaLabel={editLabel}
            hoverClass='trip-context-chips__edit--pressed'
            onClick={onEdit}
          >
            {editLabel}
          </Button>
        )}
      </View>

      {chips.length > 0 ? (
        <View className='trip-context-chips__list' role='list'>
          {chips.map(chip => (
            <View className='trip-context-chips__chip' key={chip.id} role='listitem' ariaLabel={chip.label}>
              <Text className='trip-context-chips__label'>{chip.label}</Text>
              {onRemove && (
                <Button
                  className='trip-context-chips__remove'
                  plain
                  ariaLabel={chip.removeLabel}
                  hoverClass='trip-context-chips__remove--pressed'
                  onClick={() => onRemove(chip)}
                >
                  ×
                </Button>
              )}
            </View>
          ))}
        </View>
      ) : (
        <Text className='trip-context-chips__empty'>{resolvedEmptyLabel}</Text>
      )}
    </View>
  )
}

export { formatTripContextChips }
