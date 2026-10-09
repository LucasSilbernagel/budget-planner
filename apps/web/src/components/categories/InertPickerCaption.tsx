import type React from 'react'

const LABEL_CLASS = 'block text-sm font-medium text-label mb-1'

// A <span>, not a <label>: neither state renders a form control a label could target.
export function InertPickerCaption(): React.ReactElement {
	return <span className={LABEL_CLASS}>Category</span>
}
