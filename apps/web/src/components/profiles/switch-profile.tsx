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
import { profileColor, profileIcon } from '@/lib/profile-appearance'
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
  // routed through the shared hash `profile-list.tsx` already used.
  const getProfileColor = profileColor
  const getProfileIcon = profileIcon

  const toggleDropdown = () => setIsOpen(!isOpen)

  const handleSwitch = (profileId: string) => {
    switchToProfile(profileId)
    setIsOpen(false)
  }

  if (!activeProfile || profiles.length <= 1) {
    return null
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown button */}
      <button
        type="button"
        onClick={toggleDropdown}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-lg ${getProfileColor(
            activeProfile.id
          )}`}
        >
          {getProfileIcon(activeProfile.id)}
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium text-gray-900">{activeProfile.name}</span>
          {hasMultipleProfiles && (
            <span className="text-xs text-gray-500">
              {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          aria-hidden="true"
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
          {/* Header */}
          <div className="px-4 py-2 border-b border-gray-200">
            <p className="text-sm font-medium text-gray-700">Switch Profile</p>
          </div>

          {/* Profile list */}
          <div className="max-h-80 overflow-y-auto">
            {profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                onClick={() => handleSwitch(profile.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                  profile.id === activeProfile.id ? 'bg-blue-50' : ''
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-lg ${getProfileColor(
                    profile.id
                  )}`}
                >
                  {getProfileIcon(profile.id)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{profile.name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {profile.description || 'No description'}
                  </p>
                </div>
                {profile.id === activeProfile.id && (
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4 text-blue-600"
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

          {/* Footer with manage link */}
          <div className="px-4 py-2 border-t border-gray-200">
            <a
              href="/profiles"
              className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
            >
              Manage Profiles →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// Export a simpler version for the navbar
export function SwitchProfileSimple() {
  const { activeProfile } = useProfilesWithActive()
  const hasMultipleProfiles = useHasMultipleProfiles()

  if (!activeProfile || !hasMultipleProfiles) {
    return null
  }

  const color = profileColor(activeProfile.id)
  const icon = profileIcon(activeProfile.id)

  return (
    <a
      href="/profiles"
      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-lg ${color}`}
      >
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-900">{activeProfile.name}</span>
        <span className="text-xs text-gray-500">Active Profile</span>
      </div>
    </a>
  )
}
