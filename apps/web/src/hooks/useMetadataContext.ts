import { useContext } from 'react'
import { MetadataContext, type MetadataContextValue } from '../context/metadata-context'

export function useMetadataContext(): MetadataContextValue {
	const ctx = useContext(MetadataContext)
	if (ctx === null) {
		throw new Error('useMetadata/useAnalytics must be used within a <MetadataProvider>')
	}
	return ctx
}
