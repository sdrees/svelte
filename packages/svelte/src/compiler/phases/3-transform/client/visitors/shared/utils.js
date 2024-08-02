/** @import { Expression, ExpressionStatement, Identifier, MemberExpression, Statement, Super, TemplateElement, TemplateLiteral } from 'estree' */
/** @import { BindDirective, ExpressionMetadata, ExpressionTag, OnDirective, SvelteNode, Text } from '#compiler' */
/** @import { ComponentClientTransformState, ComponentContext } from '../../types' */
import { walk } from 'zimmerframe';
import { object } from '../../../../../utils/ast.js';
import * as b from '../../../../../utils/builders.js';
import { sanitize_template_string } from '../../../../../utils/sanitize_template_string.js';
import { regex_is_valid_identifier } from '../../../../patterns.js';
import { create_derived } from '../../utils.js';
import is_reference from 'is-reference';
import { locator } from '../../../../../state.js';

/**
 * @param {Array<Text | ExpressionTag>} values
 * @param {(node: SvelteNode, state: any) => any} visit
 * @param {ComponentClientTransformState} state
 * @returns {[boolean, TemplateLiteral]}
 */
export function build_template_literal(values, visit, state) {
	/** @type {TemplateElement[]} */
	const quasis = [];

	/** @type {Expression[]} */
	const expressions = [];
	let has_call = false;
	let contains_multiple_call_expression = false;
	quasis.push(b.quasi(''));

	for (let i = 0; i < values.length; i++) {
		const node = values[i];

		if (node.type === 'ExpressionTag' && node.metadata.expression.has_call) {
			if (has_call) {
				contains_multiple_call_expression = true;
			}
			has_call = true;
		}
	}

	for (let i = 0; i < values.length; i++) {
		const node = values[i];

		if (node.type === 'Text') {
			const last = /** @type {TemplateElement} */ (quasis.at(-1));
			last.value.raw += sanitize_template_string(node.data);
		} else if (node.type === 'ExpressionTag' && node.expression.type === 'Literal') {
			const last = /** @type {TemplateElement} */ (quasis.at(-1));
			if (node.expression.value != null) {
				last.value.raw += sanitize_template_string(node.expression.value + '');
			}
		} else {
			if (contains_multiple_call_expression) {
				const id = b.id(state.scope.generate('stringified_text'));

				state.init.push(
					b.const(
						id,
						create_derived(
							state,
							b.thunk(/** @type {Expression} */ (visit(node.expression, state)))
						)
					)
				);
				expressions.push(b.call('$.get', id));
			} else {
				expressions.push(b.logical('??', visit(node.expression, state), b.literal('')));
			}
			quasis.push(b.quasi('', i + 1 === values.length));
		}
	}

	// TODO instead of this tuple, return a `{ dynamic, complex, value }` object. will DRY stuff out
	return [has_call, b.template(quasis, expressions)];
}

/**
 * @param {Statement} statement
 */
export function build_update(statement) {
	const body =
		statement.type === 'ExpressionStatement' ? statement.expression : b.block([statement]);

	return b.stmt(b.call('$.template_effect', b.thunk(body)));
}

/**
 * @param {Statement[]} update
 */
export function build_render_statement(update) {
	return update.length === 1
		? build_update(update[0])
		: b.stmt(b.call('$.template_effect', b.thunk(b.block(update))));
}

/**
 * For unfortunate legacy reasons, directive names can look like this `use:a.b-c`
 * This turns that string into a member expression
 * @param {string} name
 */
export function parse_directive_name(name) {
	// this allow for accessing members of an object
	const parts = name.split('.');
	let part = /** @type {string} */ (parts.shift());

	/** @type {Identifier | MemberExpression} */
	let expression = b.id(part);

	while ((part = /** @type {string} */ (parts.shift()))) {
		const computed = !regex_is_valid_identifier.test(part);
		expression = b.member(expression, computed ? b.literal(part) : b.id(part), computed);
	}

	return expression;
}

/**
 * @param {ComponentClientTransformState} state
 * @param {string} id
 * @param {Expression | undefined} init
 * @param {Expression} value
 * @param {ExpressionStatement} update
 */
export function build_update_assignment(state, id, init, value, update) {
	state.init.push(b.var(id, init));
	state.update.push(
		b.if(b.binary('!==', b.id(id), b.assignment('=', b.id(id), value)), b.block([update]))
	);
}

/**
 * Serializes the event handler function of the `on:` directive
 * @param {Pick<OnDirective, 'name' | 'modifiers' | 'expression'>} node
 * @param {null | ExpressionMetadata} metadata
 * @param {ComponentContext} context
 */
export function build_event_handler(node, metadata, { state, visit }) {
	/** @type {Expression} */
	let handler;

	if (node.expression) {
		handler = node.expression;

		// Event handlers can be dynamic (source/store/prop/conditional etc)
		const dynamic_handler = () =>
			b.function(
				null,
				[b.rest(b.id('$$args'))],
				b.block([
					b.return(
						b.call(
							b.member(/** @type {Expression} */ (visit(handler)), b.id('apply'), false, true),
							b.this,
							b.id('$$args')
						)
					)
				])
			);

		if (
			metadata?.has_call &&
			!(
				(handler.type === 'ArrowFunctionExpression' || handler.type === 'FunctionExpression') &&
				handler.metadata.hoistable
			)
		) {
			// Create a derived dynamic event handler
			const id = b.id(state.scope.generate('event_handler'));

			state.init.push(
				b.var(id, b.call('$.derived', b.thunk(/** @type {Expression} */ (visit(handler)))))
			);

			handler = b.function(
				null,
				[b.rest(b.id('$$args'))],
				b.block([
					b.return(
						b.call(
							b.member(b.call('$.get', id), b.id('apply'), false, true),
							b.this,
							b.id('$$args')
						)
					)
				])
			);
		} else if (handler.type === 'Identifier' || handler.type === 'MemberExpression') {
			const id = object(handler);
			const binding = id === null ? null : state.scope.get(id.name);
			if (
				binding !== null &&
				(binding.kind === 'state' ||
					binding.kind === 'frozen_state' ||
					binding.declaration_kind === 'import' ||
					binding.kind === 'legacy_reactive' ||
					binding.kind === 'derived' ||
					binding.kind === 'prop' ||
					binding.kind === 'bindable_prop' ||
					binding.kind === 'store_sub')
			) {
				handler = dynamic_handler();
			} else {
				handler = /** @type {Expression} */ (visit(handler));
			}
		} else if (handler.type === 'ConditionalExpression' || handler.type === 'LogicalExpression') {
			handler = dynamic_handler();
		} else {
			handler = /** @type {Expression} */ (visit(handler));
		}
	} else {
		state.analysis.needs_props = true;

		// Function + .call to preserve "this" context as much as possible
		handler = b.function(
			null,
			[b.id('$$arg')],
			b.block([b.stmt(b.call('$.bubble_event.call', b.this, b.id('$$props'), b.id('$$arg')))])
		);
	}

	if (node.modifiers.includes('stopPropagation')) {
		handler = b.call('$.stopPropagation', handler);
	}
	if (node.modifiers.includes('stopImmediatePropagation')) {
		handler = b.call('$.stopImmediatePropagation', handler);
	}
	if (node.modifiers.includes('preventDefault')) {
		handler = b.call('$.preventDefault', handler);
	}
	if (node.modifiers.includes('self')) {
		handler = b.call('$.self', handler);
	}
	if (node.modifiers.includes('trusted')) {
		handler = b.call('$.trusted', handler);
	}

	return handler;
}

/**
 * Serializes `bind:this` for components and elements.
 * @param {Identifier | MemberExpression} expression
 * @param {Expression} value
 * @param {import('zimmerframe').Context<SvelteNode, ComponentClientTransformState>} context
 */
export function build_bind_this(expression, value, { state, visit }) {
	/** @type {Identifier[]} */
	const ids = [];

	/** @type {Expression[]} */
	const values = [];

	/** @type {typeof state.getters} */
	const getters = {};

	// Pass in each context variables to the get/set functions, so that we can null out old values on teardown.
	// Note that we only do this for each context variables, the consequence is that the value might be stale in
	// some scenarios where the value is a member expression with changing computed parts or using a combination of multiple
	// variables, but that was the same case in Svelte 4, too. Once legacy mode is gone completely, we can revisit this.
	walk(expression, null, {
		Identifier(node, { path }) {
			if (Object.hasOwn(getters, node.name)) return;

			const parent = /** @type {Expression} */ (path.at(-1));
			if (!is_reference(node, parent)) return;

			const binding = state.scope.get(node.name);
			if (!binding) return;

			for (const [owner, scope] of state.scopes) {
				if (owner.type === 'EachBlock' && scope === binding.scope) {
					ids.push(node);
					values.push(/** @type {Expression} */ (visit(node)));
					getters[node.name] = node;
					break;
				}
			}
		}
	});

	const child_state = { ...state, getters: { ...state.getters, ...getters } };

	const get = /** @type {Expression} */ (visit(expression, child_state));
	const set = /** @type {Expression} */ (
		visit(b.assignment('=', expression, b.id('$$value')), child_state)
	);

	// If we're mutating a property, then it might already be non-existent.
	// If we make all the object nodes optional, then it avoids any runtime exceptions.
	/** @type {Expression | Super} */
	let node = get;

	while (node.type === 'MemberExpression') {
		node.optional = true;
		node = node.object;
	}

	return b.call(
		'$.bind_this',
		value,
		b.arrow([b.id('$$value'), ...ids], set),
		b.arrow([...ids], get),
		values.length > 0 && b.thunk(b.array(values))
	);
}

/**
 * @param {ComponentClientTransformState} state
 * @param {BindDirective} binding
 * @param {MemberExpression} expression
 */
export function build_validate_binding(state, binding, expression) {
	const string = state.analysis.source.slice(binding.start, binding.end);

	const get_object = b.thunk(/** @type {Expression} */ (expression.object));
	const get_property = b.thunk(
		/** @type {Expression} */ (
			expression.computed
				? expression.property
				: b.literal(/** @type {Identifier} */ (expression.property).name)
		)
	);

	const loc = locator(binding.start);

	return b.stmt(
		b.call(
			'$.validate_binding',
			b.literal(string),
			get_object,
			get_property,
			loc && b.literal(loc.line),
			loc && b.literal(loc.column)
		)
	);
}
