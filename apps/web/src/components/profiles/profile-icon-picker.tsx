/**
 * Profile icon picker, shared by the create and edit dialogs (story 98.1, FR159).
 *
 * Moved verbatim out of `edit-profile.tsx` (story 54.2, FR78) so both dialogs
 * render ONE component with ONE keyboard contract, rather than two copies that
 * can drift. The edit dialog's existing radiogroup + keyboard tests
 * (`__tests__/edit-profile.test.tsx`) passing unmodified is the extraction's
 * regression proof; `__tests__/create-profile.test.tsx` drives the same contract
 * through the create dialog.
 */

import { PROFILE_ICONS, PROFILE_ICON_LABELS, type ProfileIcon } from '@/lib/profile-appearance'
import { useRef } from 'react'

interface ProfileIconPickerProps {
  /** The selected icon. A value outside `PROFILE_ICONS` selects nothing. */
  value: string
  onChange: (icon: ProfileIcon) => void
  /**
   * Prefix for the visible label's id (`<idPrefix>-icon-label`), so two dialogs
   * never share an id. The accessible name stays `Profile Icon`.
   */
  idPrefix: string
}

export function ProfileIconPicker({ value, onChange, idPrefix }: ProfileIconPickerProps) {
  // One slot per icon option, so the arrow-key handler can move focus under the
  // roving tabindex (the unselected options are not focusable on their own).
  const iconRefs = useRef<(HTMLButtonElement | null)[]>([])
  const labelId = `${idPrefix}-icon-label`

  /**
   * The WAI-ARIA radiogroup keyboard contract for the icon picker (code review
   * 54.2). Arrows move to the adjacent option, wrapping at both ends; Home/End
   * jump to the first/last. Moving SELECTS as it goes, which is the standard
   * behaviour for a radiogroup and what `aria-checked` then announces.
   *
   * Focus is moved explicitly because the roving tabindex leaves the other seven
   * options unfocusable — without this the browser has nowhere to send focus.
   */
  const handleIconKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const count = PROFILE_ICONS.length
    const current = PROFILE_ICONS.findIndex((icon) => icon === value)
    // -1 when the stored value is not one of the eight; start from the first so
    // the keyboard still works on a profile holding an unrecognised icon.
    const from = current === -1 ? 0 : current

    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (from + 1) % count
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (from - 1 + count) % count
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }

    // Only now, once we know the key was ours: an unhandled key must keep its
    // default (Tab must still leave the group, Escape must still close the modal).
    e.preventDefault()
    const icon = PROFILE_ICONS[next]
    if (icon) {
      onChange(icon)
      iconRefs.current[next]?.focus()
    }
  }

  return (
    <div>
      <span id={labelId} className="block text-sm font-medium text-label mb-1">
        Profile Icon
      </span>
      {/*
        A radiogroup rather than eight independent toggles: exactly one is
        chosen at a time.
        ⚠️ Choosing `role="radio"` OBLIGES us to implement the radiogroup
        keyboard contract, because assistive tech announces "N of 8" and tells
        the user to arrow between options. Code review 54.2 caught this
        promising behaviour the widget did not have. Hence `onKeyDown` below
        and the roving tabindex: exactly ONE option is in the tab order, and
        arrows move (and select) within the group.
      */}
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2"
        onKeyDown={handleIconKeyDown}
      >
        {PROFILE_ICONS.map((icon, index) => {
          const selected = value === icon
          return (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={selected}
              // ⚠️ An emoji is not an accessible name — see PROFILE_ICON_LABELS.
              aria-label={PROFILE_ICON_LABELS[icon]}
              // Roving tabindex: Tab enters the group once, landing on the
              // selected option, rather than stopping on all eight.
              tabIndex={selected ? 0 : -1}
              ref={(el) => {
                iconRefs.current[index] = el
              }}
              onClick={() => onChange(icon)}
              className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                selected
                  ? // ⚠️ The selected state must NOT be carried by colour alone
                    // (WCAG 1.4.1). Code review 54.2 found the original pair
                    // differed only in hue — `border-2` was in the shared base
                    // string, and the only ring was `focus:`, i.e. focus state,
                    // not selection state. The BORDER WIDTH now differs (4 vs 2),
                    // which survives both colour-blindness and a monochrome
                    // rendering. `dark:border-blue-300` rather than `-400` lifts
                    // the dark-mode non-text contrast above 1.4.11's 3:1.
                    'border-4 border-blue-600 bg-blue-50 dark:border-blue-300 dark:bg-blue-950/40'
                  : 'border-2 border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
              }`}
            >
              <span aria-hidden="true">{icon}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
