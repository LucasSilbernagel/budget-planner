import { CompareLayout } from './compare-layout'

// Lives outside the route file: a non-route export there stops the router code-splitting it.
export function CompareNotFound() {
	return (
		<CompareLayout title="Comparison not found" activeSlug={null}>
			<section className="rounded-lg surface p-6 shadow-md">
				<p className="text-body">
					We don't have that comparison.{' '}
					<a href="/compare" className="text-accent underline">
						See all comparisons
					</a>
					.
				</p>
			</section>
		</CompareLayout>
	)
}
