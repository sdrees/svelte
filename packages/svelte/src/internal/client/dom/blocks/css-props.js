import { namespace_svg } from '../../../../constants.js';
import { current_hydration_fragment, hydrate_block_anchor, hydrating } from '../hydration.js';
import { empty } from '../operations.js';
import { render_effect } from '../../reactivity/effects.js';
import { insert, remove } from '../reconciler.js';

/**
 * @param {Element | Text | Comment} anchor
 * @param {boolean} is_html
 * @param {() => Record<string, string>} props
 * @param {(anchor: Element | Text | Comment) => any} component
 * @returns {void}
 */
export function css_props(anchor, is_html, props, component) {
	hydrate_block_anchor(anchor);

	/** @type {HTMLElement | SVGElement} */
	let tag;

	/** @type {Text | Comment} */
	let component_anchor;

	if (hydrating) {
		// Hydration: css props element is surrounded by a ssr comment ...
		tag = /** @type {HTMLElement | SVGElement} */ (current_hydration_fragment[0]);
		// ... and the child(ren) of the css props element is also surround by a ssr comment
		component_anchor = /** @type {Comment} */ (tag.firstChild);
	} else {
		if (is_html) {
			tag = document.createElement('div');
			tag.style.display = 'contents';
		} else {
			tag = document.createElementNS(namespace_svg, 'g');
		}

		insert(tag, null, anchor);
		component_anchor = empty();
		tag.appendChild(component_anchor);
	}

	component(component_anchor);

	/** @type {Record<string, string>} */
	let current_props = {};

	const effect = render_effect(() => {
		const next_props = props();

		for (const key in current_props) {
			if (!(key in next_props)) {
				tag.style.removeProperty(key);
			}
		}

		for (const key in next_props) {
			tag.style.setProperty(key, next_props[key]);
		}

		current_props = next_props;
	});

	effect.ondestroy = () => {
		remove(tag);
	};
}
