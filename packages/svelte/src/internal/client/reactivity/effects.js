import { DEV } from 'esm-env';
import {
	check_dirtiness,
	current_component_context,
	current_effect,
	current_reaction,
	destroy_children,
	execute_effect,
	get,
	is_flushing_effect,
	remove_reactions,
	schedule_effect,
	set_is_flushing_effect,
	set_signal_status,
	untrack
} from '../runtime.js';
import {
	DIRTY,
	BRANCH_EFFECT,
	RENDER_EFFECT,
	EFFECT,
	PRE_EFFECT,
	DESTROYED,
	INERT,
	IS_ELSEIF,
	EFFECT_RAN,
	BLOCK_EFFECT,
	ROOT_EFFECT
} from '../constants.js';
import { set } from './sources.js';
import { noop } from '../../common.js';
import { remove } from '../dom/reconciler.js';

/**
 * @param {import('./types.js').EffectType} type
 * @param {(() => void | (() => void))} fn
 * @param {boolean} sync
 * @param {boolean} init
 * @returns {import('#client').Effect}
 */
function create_effect(type, fn, sync, init = true) {
	var is_root = (type & ROOT_EFFECT) !== 0;
	/** @type {import('#client').Effect} */
	var effect = {
		parent: is_root ? null : current_effect,
		dom: null,
		deps: null,
		f: type | DIRTY,
		l: 0,
		fn,
		effects: null,
		deriveds: null,
		teardown: null,
		ctx: current_component_context,
		transitions: null
	};

	if (current_effect !== null) {
		effect.l = current_effect.l + 1;
	}

	if (current_reaction !== null && !is_root) {
		if (current_reaction.effects === null) {
			current_reaction.effects = [effect];
		} else {
			current_reaction.effects.push(effect);
		}
	}

	if (init) {
		if (sync) {
			var previously_flushing_effect = is_flushing_effect;

			try {
				set_is_flushing_effect(true);
				execute_effect(effect);
				effect.f |= EFFECT_RAN;
			} finally {
				set_is_flushing_effect(previously_flushing_effect);
			}
		} else {
			schedule_effect(effect);
		}
	}

	return effect;
}

/**
 * Internal representation of `$effect.active()`
 * @returns {boolean}
 */
export function effect_active() {
	return current_effect ? (current_effect.f & (BRANCH_EFFECT | ROOT_EFFECT)) === 0 : false;
}

/**
 * Internal representation of `$effect(...)`
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function user_effect(fn) {
	if (current_effect === null) {
		throw new Error(
			'ERR_SVELTE_ORPHAN_EFFECT' +
				(DEV ? ': The Svelte $effect rune can only be used during component initialisation.' : '')
		);
	}

	// Non-nested `$effect(...)` in a component should be deferred
	// until the component is mounted
	const defer =
		current_effect.f & RENDER_EFFECT &&
		// TODO do we actually need this? removing them changes nothing
		current_component_context !== null &&
		!current_component_context.m;

	const effect = create_effect(EFFECT, fn, false, !defer);

	if (defer) {
		const context = /** @type {import('#client').ComponentContext} */ (current_component_context);
		(context.e ??= []).push(effect);
	}

	return effect;
}

/**
 * Internal representation of `$effect.pre(...)`
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function user_pre_effect(fn) {
	if (current_effect === null) {
		throw new Error(
			'ERR_SVELTE_ORPHAN_EFFECT' +
				(DEV
					? ': The Svelte $effect.pre rune can only be used during component initialisation.'
					: '')
		);
	}

	return pre_effect(fn);
}

/**
 * Internal representation of `$effect.root(...)`
 * @param {() => void | (() => void)} fn
 * @returns {() => void}
 */
export function effect_root(fn) {
	const effect = create_effect(ROOT_EFFECT, () => untrack(fn), true);
	return () => {
		destroy_effect(effect);
	};
}

/**
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function effect(fn) {
	return create_effect(EFFECT, fn, false);
}

/**
 * Internal representation of `$: ..`
 * @param {() => any} deps
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function legacy_pre_effect(deps, fn) {
	const component_context = /** @type {import('#client').ComponentContext} */ (
		current_component_context
	);
	const token = {};
	return pre_effect(() => {
		deps();
		if (component_context.l1.includes(token)) {
			return;
		}
		component_context.l1.push(token);
		set(component_context.l2, true);
		return untrack(fn);
	});
}

export function legacy_pre_effect_reset() {
	const component_context = /** @type {import('#client').ComponentContext} */ (
		current_component_context
	);
	return render_effect(() => {
		const x = get(component_context.l2);
		if (x) {
			component_context.l1.length = 0;
			component_context.l2.v = false; // set directly to avoid rerunning this effect
		}
	});
}

/**
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function pre_effect(fn) {
	return create_effect(PRE_EFFECT, fn, true);
}

/**
 * @param {(() => void)} fn
 * @returns {import('#client').Effect}
 */
export function render_effect(fn) {
	return create_effect(RENDER_EFFECT, fn, true);
}

/** @param {(() => void)} fn */
export function block(fn) {
	return create_effect(RENDER_EFFECT | BLOCK_EFFECT, fn, true);
}

/** @param {(() => void)} fn */
export function branch(fn) {
	return create_effect(RENDER_EFFECT | BRANCH_EFFECT, fn, true);
}

/**
 * @param {import('#client').Effect} effect
 * @returns {void}
 */
export function destroy_effect(effect) {
	destroy_children(effect);
	remove_reactions(effect, 0);
	set_signal_status(effect, DESTROYED);

	if (effect.transitions) {
		for (const transition of effect.transitions) {
			transition.stop();
		}
	}

	effect.teardown?.();

	if (effect.dom !== null) {
		remove(effect.dom);
	}

	effect.effects =
		effect.teardown =
		effect.ctx =
		effect.dom =
		effect.deps =
		// @ts-expect-error
		effect.fn =
			null;
}

/**
 * When a block effect is removed, we don't immediately destroy it or yank it
 * out of the DOM, because it might have transitions. Instead, we 'pause' it.
 * It stays around (in memory, and in the DOM) until outro transitions have
 * completed, and if the state change is reversed then we _resume_ it.
 * A paused effect does not update, and the DOM subtree becomes inert.
 * @param {import('#client').Effect} effect
 * @param {() => void} callback
 */
export function pause_effect(effect, callback = noop) {
	/** @type {import('#client').TransitionManager[]} */
	var transitions = [];

	pause_children(effect, transitions, true);

	out(transitions, () => {
		destroy_effect(effect);
		callback();
	});
}

/**
 * Pause multiple effects simultaneously, and coordinate their
 * subsequent destruction. Used in each blocks
 * @param {import('#client').Effect[]} effects
 * @param {() => void} callback
 */
export function pause_effects(effects, callback = noop) {
	/** @type {import('#client').TransitionManager[]} */
	var transitions = [];

	for (var effect of effects) {
		pause_children(effect, transitions, true);
	}

	out(transitions, () => {
		for (var effect of effects) {
			destroy_effect(effect);
		}
		callback();
	});
}

/**
 * @param {import('#client').TransitionManager[]} transitions
 * @param {() => void} fn
 */
function out(transitions, fn) {
	var remaining = transitions.length;
	if (remaining > 0) {
		var check = () => --remaining || fn();
		for (var transition of transitions) {
			transition.out(check);
		}
	} else {
		fn();
	}
}

/**
 * @param {import('#client').Effect} effect
 * @param {import('#client').TransitionManager[]} transitions
 * @param {boolean} local
 */
function pause_children(effect, transitions, local) {
	if ((effect.f & INERT) !== 0) return;
	effect.f ^= INERT;

	if (effect.transitions !== null) {
		for (const transition of effect.transitions) {
			if (transition.is_global || local) {
				transitions.push(transition);
			}
		}
	}

	if (effect.effects !== null) {
		for (const child of effect.effects) {
			var transparent = (child.f & IS_ELSEIF) !== 0 || (child.f & BRANCH_EFFECT) !== 0;
			pause_children(child, transitions, transparent ? local : false);
		}
	}
}

/**
 * The opposite of `pause_effect`. We call this if (for example)
 * `x` becomes falsy then truthy: `{#if x}...{/if}`
 * @param {import('#client').Effect} effect
 */
export function resume_effect(effect) {
	resume_children(effect, true);
}

/**
 * @param {import('#client').Effect} effect
 * @param {boolean} local
 */
function resume_children(effect, local) {
	if ((effect.f & INERT) === 0) return;
	effect.f ^= INERT;

	// If a dependency of this effect changed while it was paused,
	// apply the change now
	if (check_dirtiness(effect)) {
		execute_effect(effect);
	}

	if (effect.effects !== null) {
		for (const child of effect.effects) {
			var transparent = (child.f & IS_ELSEIF) !== 0 || (child.f & BRANCH_EFFECT) !== 0;
			resume_children(child, transparent ? local : false);
		}
	}

	if (effect.transitions !== null) {
		for (const transition of effect.transitions) {
			if (transition.is_global || local) {
				transition.in();
			}
		}
	}
}
