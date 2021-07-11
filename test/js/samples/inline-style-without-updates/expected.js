/* generated by Svelte vX.Y.Z */
import {
	SvelteComponent,
	detach,
	element,
	init,
	insert,
	noop,
	safe_not_equal,
	set_style
} from "svelte/internal";

function create_fragment(ctx) {
	let div;

	return {
		c() {
			div = element("div");
			set_style(div, "color", color);
		},
		m(target, anchor) {
			insert(target, div, anchor);
		},
		p: noop,
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div);
		}
	};
}

let color = 'red';

class Component extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment, safe_not_equal, {});
	}
}

export default Component;