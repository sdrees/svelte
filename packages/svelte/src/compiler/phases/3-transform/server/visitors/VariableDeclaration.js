/** @import { VariableDeclaration, VariableDeclarator, Expression, CallExpression, Pattern, Identifier } from 'estree' */
/** @import { Binding } from '#compiler' */
/** @import { Context } from '../types.js' */
/** @import { Scope } from '../../../scope.js' */
import { extract_paths, is_expression_async } from '../../../../utils/ast.js';
import * as b from '../../../../utils/builders.js';
import { get_rune } from '../../../scope.js';
import { walk } from 'zimmerframe';

/**
 * @param {VariableDeclaration} node
 * @param {Context} context
 */
export function VariableDeclarationRunes(node, context) {
	const declarations = [];

	for (const declarator of node.declarations) {
		const init = declarator.init;
		const rune = get_rune(init, context.state.scope);
		if (!rune || rune === '$effect.tracking' || rune === '$inspect' || rune === '$effect.root') {
			declarations.push(/** @type {VariableDeclarator} */ (context.visit(declarator)));
			continue;
		}

		if (rune === '$props') {
			// remove $bindable() from props declaration
			const id = walk(declarator.id, null, {
				AssignmentPattern(node) {
					if (
						node.right.type === 'CallExpression' &&
						get_rune(node.right, context.state.scope) === '$bindable'
					) {
						const right = node.right.arguments.length
							? /** @type {Expression} */ (context.visit(node.right.arguments[0]))
							: b.id('undefined');
						return b.assignment_pattern(node.left, right);
					}
				}
			});
			declarations.push(b.declarator(id, b.id('$$props')));
			continue;
		}

		const args = /** @type {CallExpression} */ (init).arguments;
		const value =
			args.length === 0 ? b.id('undefined') : /** @type {Expression} */ (context.visit(args[0]));

		if (rune === '$derived.by') {
			declarations.push(
				b.declarator(/** @type {Pattern} */ (context.visit(declarator.id)), b.call(value))
			);
			continue;
		}

		if (declarator.id.type === 'Identifier') {
			declarations.push(b.declarator(declarator.id, value));
			continue;
		}

		if (rune === '$derived') {
			declarations.push(b.declarator(/** @type {Pattern} */ (context.visit(declarator.id)), value));
			continue;
		}

		declarations.push(...create_state_declarators(declarator, context.state.scope, value));
	}

	return {
		...node,
		declarations
	};
}

/**
 * @param {VariableDeclaration} node
 * @param {Context} context
 */
export function VariableDeclarationLegacy(node, { state, visit }) {
	/** @type {VariableDeclarator[]} */
	const declarations = [];

	for (const declarator of node.declarations) {
		const bindings = /** @type {Binding[]} */ (state.scope.get_bindings(declarator));
		const has_state = bindings.some((binding) => binding.kind === 'state');
		const has_props = bindings.some((binding) => binding.kind === 'bindable_prop');

		if (!has_state && !has_props) {
			declarations.push(/** @type {VariableDeclarator} */ (visit(declarator)));
			continue;
		}

		if (has_props) {
			if (declarator.id.type !== 'Identifier') {
				// Turn export let into props. It's really really weird because export let { x: foo, z: [bar]} = ..
				// means that foo and bar are the props (i.e. the leafs are the prop names), not x and z.
				const tmp = state.scope.generate('tmp');
				const paths = extract_paths(declarator.id);
				declarations.push(
					b.declarator(
						b.id(tmp),
						/** @type {Expression} */ (visit(/** @type {Expression} */ (declarator.init)))
					)
				);
				for (const path of paths) {
					const value = path.expression?.(b.id(tmp));
					const name = /** @type {Identifier} */ (path.node).name;
					const binding = /** @type {Binding} */ (state.scope.get(name));
					const prop = b.member(b.id('$$props'), b.literal(binding.prop_alias ?? name), true);
					declarations.push(
						b.declarator(path.node, b.call('$.value_or_fallback', prop, b.thunk(value)))
					);
				}
				continue;
			}

			const binding = /** @type {Binding} */ (state.scope.get(declarator.id.name));
			const prop = b.member(
				b.id('$$props'),
				b.literal(binding.prop_alias ?? declarator.id.name),
				true
			);

			/** @type {Expression} */
			let init = prop;
			if (declarator.init) {
				const default_value = /** @type {Expression} */ (visit(declarator.init));
				init = is_expression_async(default_value)
					? b.await(b.call('$.value_or_fallback_async', prop, b.thunk(default_value, true)))
					: b.call('$.value_or_fallback', prop, b.thunk(default_value));
			}

			declarations.push(b.declarator(declarator.id, init));

			continue;
		}

		declarations.push(
			...create_state_declarators(
				declarator,
				state.scope,
				/** @type {Expression} */ (declarator.init && visit(declarator.init))
			)
		);
	}

	return {
		...node,
		declarations
	};
}

/**
 * @param {VariableDeclarator} declarator
 * @param {Scope} scope
 * @param {Expression} value
 * @returns {VariableDeclarator[]}
 */
function create_state_declarators(declarator, scope, value) {
	if (declarator.id.type === 'Identifier') {
		return [b.declarator(declarator.id, value)];
	}

	const tmp = scope.generate('tmp');
	const paths = extract_paths(declarator.id);
	return [
		b.declarator(b.id(tmp), value), // TODO inject declarator for opts, so we can use it below
		...paths.map((path) => {
			const value = path.expression?.(b.id(tmp));
			return b.declarator(path.node, value);
		})
	];
}
