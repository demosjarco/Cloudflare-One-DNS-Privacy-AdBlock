import { component$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';

export const head: DocumentHead = {
	title: 'Gateway Lists',
	meta: [
		{
			name: 'description',
			content: 'Qwik site description',
		},
	],
};

export default component$(() => {
	return (
		<>
			<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque quam orci, bibendum sit amet consequat ut, gravida in felis. Proin non iaculis dui. Nam varius, justo eu interdum fringilla, odio leo tempus nisi, sit amet iaculis libero lectus nec mauris. Duis non consequat eros. Morbi facilisis dapibus interdum. Curabitur pulvinar metus varius pharetra tincidunt. Aenean sed tellus in justo convallis ornare. Cras massa tortor, mattis sit amet sapien vitae, rutrum elementum magna. Cras congue, nunc sit amet laoreet pretium, neque dolor tristique erat, ac laoreet nibh turpis vehicula sapien. Praesent molestie nisl sed facilisis finibus.</p>

			<p>Nulla facilisi. Mauris imperdiet molestie velit, at venenatis lorem accumsan in. Morbi vel justo in nunc gravida pretium at in nisl. Maecenas malesuada pretium consectetur. Fusce vel quam sit amet tellus consequat euismod. In efficitur pulvinar ante eget porta. Praesent accumsan mi ut dictum maximus. Proin tincidunt purus eu nisi suscipit pretium. Vivamus pharetra pharetra tempus. Suspendisse a ultricies tortor. Ut eget venenatis tortor, quis interdum justo. Donec vestibulum nisi sit amet metus consequat dictum. Praesent eget dapibus elit. Fusce pellentesque pulvinar ipsum, ut condimentum ligula congue ut.</p>

			<p>Integer vel massa neque. Suspendisse mattis scelerisque enim eu scelerisque. Quisque id mi sapien. Integer et nulla at est aliquet porta. Phasellus pretium enim vulputate consectetur placerat. Morbi a porttitor ligula, ut fringilla tortor. Nam quis sem nec lorem porta molestie at non felis. Nulla aliquet tellus diam, nec lobortis orci euismod pulvinar.</p>

			<p>Quisque eu suscipit libero. Proin viverra arcu eu ipsum porta, a mollis lacus eleifend. Sed lacinia nunc urna, vitae luctus mi commodo sed. Pellentesque orci ligula, pellentesque sit amet maximus at, egestas in mauris. Nullam sit amet massa sit amet augue tincidunt elementum posuere a tellus. In hac habitasse platea dictumst. Etiam lobortis nec augue placerat viverra. In pulvinar eros eget arcu eleifend, vitae elementum metus tempor. Integer tortor magna, consequat efficitur tincidunt ut, rhoncus eget eros. Nam at cursus orci, quis ultrices nibh. In non mauris eu magna laoreet aliquam. Ut vel libero posuere, blandit justo a, congue ipsum. Mauris dapibus erat non lorem aliquam, nec iaculis elit viverra. Phasellus quis orci consectetur, aliquam lorem nec, efficitur eros.</p>

			<p>Aliquam dignissim placerat odio, vitae suscipit purus vestibulum venenatis. In vel libero tempus, ornare diam quis, mattis orci. Pellentesque ante ligula, finibus a ex id, consequat commodo libero. Vivamus vitae tristique erat. Ut ullamcorper laoreet volutpat. Sed volutpat condimentum nisi tincidunt convallis. Aenean et quam id ex dapibus tristique. Vestibulum in turpis porta quam ultricies bibendum. Maecenas vitae sem a mauris porttitor finibus. Morbi pulvinar convallis velit nec mollis. Aliquam placerat velit et pharetra tristique. Cras lacinia libero at mauris varius rhoncus. Nullam ac eros vel libero pharetra euismod. Fusce ultricies volutpat nisi ut eleifend.</p>
		</>
	);
});
