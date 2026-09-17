/**
 * Switch Profile Dropdown Component
 *
 * Dropdown menu for switching between user profiles.
 * Shows current active profile and allows quick switching.
 *
 * Architecture: React with Tailwind CSS
 * State Management: Zustand via useActiveProfile hook
 */

import {
  useHasMultipleProfiles,
  useProfileSwitcher,
  useProfilesWithActive,
} from '@/hooks/useActiveProfile'
import { profileColor, resolveProfileIcon } from '@/lib/profile-appearance'
import { useEffect, useRef, useState } from 'react'

// Profile color options (same as profile-list.tsx)

// Profile icon options (same as profile-list.tsx)

export function SwitchProfileDropdown() {
  const { profiles, activeProfile } = useProfilesWithActive()
  const { switchToProfile } = useProfileSwitcher()
  const hasMultipleProfiles = useHasMultipleProfiles()

  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  // ⚠️ These were `(profileId: number) => PROFILE_COLORS[profileId % …]`, and a
  // profile id has been a uuid STRING since story 5-14 — so `"a1b2…" % 8` was
  // `NaN` and every avatar here rendered with no colour class and no icon. Now
  // routed through the same shared helpers `profile-list.tsx` uses.
  //
  // ⚠️ They differ since story 54.2, and the difference is the point: COLOUR is
  // still purely hash-derived and takes an id, while the ICON takes the whole
  // profile, because a user-chosen `icon` wins over the hash.
  const getProfileColor = profileColor
  const getProfileIcon = resolveProfileIcon

  const toggleDropdown = () => setIsOpen(!isOpen)

  const handleSwitch = (profileId: string) => {
    switchToProfile(profileId)
    setIsOpen(false)
  }

  // ⚠️ Never hide the ONLY switcher just because `activeProfileId` resolves to
  // nothing (a corrupt/stale persisted blob, or an id from another device).
  // Before story 54.3 the cards' `!isActive` branch rendered "Switch to" on every
  // card, so an orphaned id still had an escape hatch; 54.3 removed that, and
  // hiding this dropdown too would leave a multi-profile user with no way back
  // except a sync pull hitting `reconcileActiveProfile` — which a free, offline
  // or lapsed user never gets. Fall back to the default profile for DISPLAY only.
  // `profiles[0]` is `T | undefined` under `noUncheckedIndexedAccess`, so the
  // narrowing below is real, not ceremonial.
  const current = activeProfile ?? profiles.find((p) => p.isDefault) ?? profiles[0]

  if (!current || profiles.length <= 1) {
    return null
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown button.
          ⚠️ The dark hover is `gray-700/50`, not the solid `gray-700` this story's
          mapping table first prescribed (code review 54.5). This button carries the
          "N profiles" count in `text-muted` — gray-400 in dark — and gray-400 on
          solid gray-700 measures 4.06:1, under AA. It fails ONLY while hovered, so
          a resting-state contrast check never sees it. Blending to 50% (#2B3544)
          lifts it to 4.88:1. The menu ROWS below keep the solid gray-700 hover
          because their text is `text-heading` / `text-body` (9.37 and 7.00 on it),
          not muted. */}
      <button
        type="button"
        onClick={toggleDropdown}
        className="flex items-center gap-2 px-3 py-2 surface border border-default rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors shadow-sm"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-lg ${getProfileColor(
            current.id
          )}`}
        >
          {getProfileIcon(current)}
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium text-heading">{current.name}</span>
          {hasMultipleProfiles && (
            <span className="text-xs text-muted">
              {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          aria-hidden="true"
          className={`w-4 h-4 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 surface rounded-xl shadow-lg border border-default py-2 z-50">
          {/* Header */}
          <div className="px-4 py-2 border-b border-default">
            <p className="text-sm font-medium text-label">Switch Profile</p>
          </div>

          {/* Profile list */}
          <div className="max-h-80 overflow-y-auto">
            {profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                onClick={() => handleSwitch(profile.id)}
                // ⚠️ Compared against the REAL `activeProfile`, not the display
                // fallback above: when the active id resolves to nothing, no row
                // should claim to be active. An orphaned state shows a usable
                // switcher with nothing ticked, rather than ticking a lie.
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  profile.id === activeProfile?.id ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-lg ${getProfileColor(
                    profile.id
                  )}`}
                >
                  {getProfileIcon(profile)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-heading truncate">{profile.name}</p>
                  {/* ⚠️ `text-body`, not `text-muted` like the card's description
                      (story 54.5). This row can sit on the `bg-blue-50` active
                      tint, where `text-muted`'s light value (gray-500) measures
                      4.44:1 — under AA. gray-600 measures 6.94:1 on the tint and
                      7.56:1 on the plain row, so one token covers both states. */}
                  <p className="text-xs text-body truncate">
                    {profile.description || 'No description'}
                  </p>
                </div>
                {profile.id === activeProfile?.id && (
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4 text-accent"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* No footer link: this dropdown's only call site is `profiles-page.tsx`,
              so a "Manage Profiles →" link to `/profiles` was always a same-page
              no-op (story 54.3, FR81). The scrollable list above ends the menu;
              the container's `py-2` supplies the bottom padding. */}
        </div>
      )}
    </div>
  )
}
