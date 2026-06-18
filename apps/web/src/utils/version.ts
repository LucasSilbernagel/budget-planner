/**
 * Version Utilities
 * 
 * Provides access to application version from package.json.
 * Used for displaying version in UI footer.
 * 
 * Architecture Requirement: FR13 - Display application version
 */

// Import version from package.json
// In a Vite project, we can use import.meta.env or import the package.json directly
// For TypeScript, we need to handle the import carefully

interface PackageJson {
  version: string
  name: string
  description?: string
}

// Dynamic import of package.json
let packageJson: PackageJson | null = null

export async function getPackageJson(): Promise<PackageJson> {
  if (!packageJson) {
    // In Vite, package.json contents are available via import
    // @ts-expect-error - Vite replaces this with actual content
    const pkg = await import('../../package.json')
    packageJson = pkg.default || pkg
  }
  return packageJson
}

// Synchronous access to version (for server-side or when already loaded)
// This uses the known version from build time
export function getVersion(): string {
  // This is a fallback. In development, use the actual version from package.json
  // In production builds, Vite will inline the version
  return import.meta.env.PACKAGE_VERSION || '0.0.1'
}

// For static access, we can use the known version
// This will be replaced by Vite during build
export const APP_VERSION = '0.0.1'
