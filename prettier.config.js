import baseConfig from '@demosjarco/prettier-config' with { type: 'json' };

/** @type {import("prettier").Config} */
export default {
	...baseConfig,
	overrides: [
		...baseConfig.overrides,
		{
			files: '**',
			options: {
				plugins: ['prettier-plugin-tailwindcss'],
			},
		},
	],
};
