import { createFileRoute } from '@tanstack/react-router'
import { CategoriesPage } from '@/components/categories/CategoriesPage'

export const Route = createFileRoute('/categories')({
	head: () => ({
		meta: [
			{ title: 'Categories · Longhand Budget' },
			{
				name: 'description',
				content: 'Create your own categories, then assign them to income sources and expenses.',
			},
		],
	}),
	component: CategoriesPage,
})
