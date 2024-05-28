---
title: Breaking changes
---

While Svelte 5 is a complete rewrite, we have done our best to ensure that most codebases can upgrade with a minimum of hassle. That said, there are a few small breaking changes which may require action on your part. They are listed here.

## Components are no longer classes

In Svelte 3 and 4, components are classes. In Svelte 5 they are functions and should be instantiated differently. If you need to manually instantiate components, you should use `mount` or `hydrate` (imported from `svelte`) instead. If you see this error using SvelteKit, try updating to the latest version of SvelteKit first, which adds support for Svelte 5. If you're using Svelte without SvelteKit, you'll likely have a `main.js` file (or similar) which you need to adjust:

```diff
+ import { mount } from 'svelte';
import App from './App.svelte'

- const app = new App({ target: document.getElementById("app") });
+ const app = mount(App, { target: document.getElementById("app") });

export default app;
```

`mount` and `hydrate` have the exact same API. The difference is that `hydrate` will pick up the Svelte's server-rendered HTML inside its target and hydrate it. Both return an object with the exports of the component and potentially property accessors (if compiled with `accesors: true`). They do not come with the `$on`, `$set` and `$destroy` methods you may know from the class component API. These are its replacements:

For `$on`, instead of listening to events, pass them via the `events` property on the options argument.

```diff
+ import { mount } from 'svelte';
import App from './App.svelte'

- const app = new App({ target: document.getElementById("app") });
- app.$on('event', callback);
+ const app = mount(App, { target: document.getElementById("app"), events: { event: callback } });
```

> Note that using `events` is discouraged — instead, [use callbacks](https://svelte-5-preview.vercel.app/docs/event-handlers)

For `$set`, use `$state` instead to create a reactive property object and manipulate it. If you're doing this inside a `.js` or `.ts` file, adjust the ending to include `.svelte`, i.e. `.svelte.js` or `.svelte.ts`.

```diff
+ import { mount } from 'svelte';
import App from './App.svelte'

- const app = new App({ target: document.getElementById("app"), props: { foo: 'bar' } });
- app.$set('event', { foo: 'baz' });
+ const props = $state({ foo: 'bar' });
+ const app = mount(App, { target: document.getElementById("app"), props });
+ props.foo = 'baz';
```

For `$destroy`, use `unmount` instead.

```diff
+ import { mount, unmount } from 'svelte';
import App from './App.svelte'

- const app = new App({ target: document.getElementById("app"), props: { foo: 'bar' } });
- app.$destroy();
+ const app = mount(App, { target: document.getElementById("app") });
+ unmount(app);
```

As a stop-gap-solution, you can also use `createClassComponent` or `asClassComponent` (imported from `svelte/legacy`) instead to keep the same API known from Svelte 4 after instantiating.

```diff
+ import { createClassComponent } from 'svelte/legacy';
import App from './App.svelte'

- const app = new App({ target: document.getElementById("app") });
+ const app = createClassComponent({ component: App, target: document.getElementById("app") });

export default app;
```

If this component is not under your control, you can use the `legacy.componentApi` compiler option for auto-applied backwards compatibility (note that this adds a bit of overhead to each component). This will also add `$set` and `$on` methods for all component instances you get through `bind:this`.

### Server API changes

Similarly, components no longer have a `render` method when compiled for server side rendering. Instead, pass the function to `render` from `svelte/server`:

```diff
+ import { render } from 'svelte/server';
import App from './App.svelte';

- const { html, head } = App.render({ message: 'hello' });
+ const { html, head } = render(App, { props: { message: 'hello' } });
```

`render` also no longer returns CSS; it should be served separately from a CSS file.

### Component typing changes

The change from classes towards functions is also reflected in the typings: `SvelteComponent`, the base class from Svelte 4, is deprecated in favor of the new `Component` type which defines the function shape of a Svelte component. To manually define a component shape in a `d.ts` file:

```ts
import type { Component } from 'svelte';
export declare const MyComponent: Component<{
	foo: string;
}>;
```

To declare that a component of a certain type is required:

```svelte
<script lang="ts">
	import type { Component } from 'svelte';
	import {
		ComponentA,
		ComponentB
	} from 'component-library';

	let component: Component<{ foo: string }> = $state(
		Math.random() ? ComponentA : ComponentB
	);
</script>

<svelte:component this={component} foo="bar" />
```

The two utility types `ComponentEvents` and `ComponentType` are also deprecated. `ComponentEvents` is obsolete because events are defined as callback props now, and `ComponentType` is obsolete because the new `Component` type is the component type already (e.g. `ComponentType<SvelteComponent<{ prop: string }>>` == `Component<{ prop: string }>`).

### bind:this changes

Because components are no longer classes, using `bind:this` no longer returns a class instance with `$set`, `$on` and `$destroy` methods on it. It only returns the instance exports (`export function/const`) and, if you're using the `accessors` option, a getter/setter-pair for each property.

## Whitespace handling changed

Previously, Svelte employed a very complicated algorithm to determine if whitespace should be kept or not. Svelte 5 simplifies this which makes it easier to reason about as a developer. The rules are:

- Whitespace between nodes is collapsed to one whitespace
- Whitespace at the start and end of a tag is removed completely
- Certain exceptions apply such as keeping whitespace inside `pre` tags

As before, you can disable whitespace trimming by setting the `preserveWhitespace` option in your compiler settings or on a per-component basis in `<svelte:options>`.

## More recent browser required

Svelte now use Mutation Observers instead of IFrames to measure dimensions for `bind:clientWidth/clientHeight/offsetWidth/offsetHeight`. It also no longer listens to the `change` event on range inputs. Lastly, the `legacy` option was removed (or rather, replaced with a different set of settings).

## Changes to compiler options

- The `false`/`true` (already deprecated previously) and the `"none"` values were removed as valid values from the `css` option
- The `legacy` option was repurposed
- The `hydratable` option has been removed. Svelte components are always hydratable now
- The `enableSourcemap` option has been removed. Source maps are always generated now, tooling can choose to ignore it
- The `tag` option was removed. Use `<svelte:options customElement="tag-name" />` inside the component instead
- The `loopGuardTimeout`, `format`, `sveltePath`, `errorMode` and `varsReport` options were removed

## The `children` prop is reserved

Content inside component tags becomes a [snippet prop](/docs/snippets) called `children`. You cannot have a separate prop by that name.

## Breaking changes in runes mode

Some breaking changes only apply once your component is in runes mode.

### Bindings to component exports are not allowed

Exports from runes mode components cannot be bound to directly. For example, having `export const foo = ...` in component `A` and then doing `<A bind:foo />` causes an error. Use `bind:this` instead — `<A bind:this={a} />` — and access the export as `a.foo`. This change makes things easier to reason about, as it enforces a clear separation between props and exports.

### Bindings need to be explicitly defined using `$bindable()`

In Svelte 4 syntax, every property (declared via `export let`) is bindable, meaning you can `bind:` to it. In runes mode, properties are not bindable by default: you need to denote bindable props with the [`$bindable`](/docs/runes#$bindable) rune.

### `accessors` option is ignored

Setting the `accessors` option to `true` makes properties of a component directly accessible on the component instance. In runes mode, properties are never accessible on the component instance. You can use component exports instead if you need to expose them.

### `immutable` option is ignored

Setting the `immutable` option has no effect in runes mode. This concept is replaced by how `$state` and its variations work.

### Classes are no longer "auto-reactive"

In Svelte 4, doing the following triggered reactivity:

```svelte
<script>
	let foo = new Foo();
</script>

<button on:click={() => (foo.value = 1)}>{foo.value}</button
>
```

This is because the Svelte compiler treated the assignment to `foo.value` as an instruction to update anything that referenced `foo`. In Svelte 5, reactivity is determined at runtime rather than compile time, so you should define `value` as a reactive `$state` field on the `Foo` class. Wrapping `new Foo()` with `$state(...)` will have no effect — only vanilla objects and arrays are made deeply reactive.

### Events and bindings use delegated handlers

Event handlers added to elements with things like `onclick={...}` or `bind:value={...}` use _delegated_ handlers where possible. This means that Svelte attaches a single event handler to a root node rather than using `addEventListener` on each individual node, resulting in better performance and memory usage.

Additionally, updates that happen inside event handlers will not be reflected in the DOM (or in `$effect(...)`) until the browser has had a chance to repaint. This ensures that your app stays responsive, and your Core Web Vitals (CWV) aren't penalised.

In very rare cases you may need to force updates to happen immediately. You can do this with `flushSync`:

```diff
<script>
+	import { flushSync } from 'svelte';

	function onclick() {
-		update_something();
+		flushSync(() => update_something());
	}
</script>
```

## Other breaking changes

### Stricter `@const` assignment validation

Assignments to destructured parts of a `@const` declaration are no longer allowed. It was an oversight that this was ever allowed.

### Stricter CSS `:global` selector validation

Previously, a compound selector starting with a global modifier which has universal or type selectors (like `:global(span).foo`) was valid. In Svelte 5, this is a validation error instead. The reason is that in this selector the resulting CSS would be equivalent to one without `:global` - in other words, `:global` is ignored in this case.

### CSS hash position no longer deterministic

Previously Svelte would always insert the CSS hash last. This is no longer guaranteed in Svelte 5. This is only breaking if you [have very weird css selectors](https://stackoverflow.com/questions/15670631/does-the-order-of-classes-listed-on-an-item-affect-the-css).

### Scoped CSS uses :where(...)

To avoid issues caused by unpredictable specificity changes, scoped CSS selectors now use `:where(.svelte-xyz123)` selector modifiers alongside `.svelte-xyz123` (where `xyz123` is, as previously, a hash of the `<style>` contents). You can read more detail [here](https://github.com/sveltejs/svelte/pull/10443).

In the event that you need to support ancient browsers that don't implement `:where`, you can manually alter the emitted CSS, at the cost of unpredictable specificity changes:

```js
// @errors: 2552
css = css.replace(/:where\((.+?)\)/, '$1');
```

### Error/warning codes have been renamed

Error and warning codes have been renamed. Previously they used dashes to separate the words, they now use underscores (e.g. foo-bar becomes foo_bar). Additionally, a handful of codes have been reworded slightly.

### Reduced number of namespaces

The number of valid namespaces you can pass to the compiler option `namespace` has been reduced to `html` (the default), `mathml`, `svg` and `foreign`.

### beforeUpdate/afterUpdate changes

`beforeUpdate` no longer runs twice on initial render if it modifies a variable referenced in the template.

`afterUpdate` callbacks in a parent component will now run after `afterUpdate` callbacks in any child components.

Both functions are disallowed in runes mode — use `$effect.pre(...)` and `$effect(...)` instead.

### `contenteditable` behavior change

If you have a `contenteditable` node with a corresponding binding _and_ a reactive value inside it (example: `<div contenteditable=true bind:textContent>count is {count}</div>`), then the value inside the contenteditable will not be updated by updates to `count` because the binding takes full control over the content immediately and it should only be updated through it.

### `oneventname` attributes no longer accept string values

In Svelte 4, it was possible to specify event attributes on HTML elements as a string:

```svelte
<button onclick="alert('hello')">...</button>
```

This is not recommended, and is no longer possible in Svelte 5, where properties like `onclick` replace `on:click` as the mechanism for adding [event handlers](/docs/event-handlers).

### `null` and `undefined` become the empty string

In Svelte 4, `null` and `undefined` were printed as the corresponding string. In 99 out of 100 cases you want this to become the empty string instead, which is also what most other frameworks out there do. Therefore, in Svelte 5, `null` and `undefined` become the empty string.

### `bind:files` values can only be `null`, `undefined` or `FileList`

`bind:files` is now a two-way binding. As such, when setting a value, it needs to be either falsy (`null` or `undefined`) or of type `FileList`.

### Bindings now react to form resets

Previously, bindings did not take into account `reset` event of forms, and therefore values could get out of sync with the DOM. Svelte 5 fixes this by placing a `reset` listener on the document and invoking bindings where necessary.

### `walk` not longer exported

`svelte/compiler` reexported `walk` from `estree-walker` for convenience. This is no longer true in Svelte 5, import it directly from that package instead in case you need it.

### Content inside `svelte:options` is forbidden

In Svelte 4 you could have content inside a `<svelte:options />` tag. It was ignored, but you could write something in there. In Svelte 5, content inside that tag is a compiler error.

### `<slot>` elements in declarative shadow roots are preserved

Svelte 4 replaced the `<slot />` tag in all places with its own version of slots. Svelte 5 preserves them in the case they are a child of a `<template shadowrootmode="...">` element.

### `<svelte:element>` tag must be an expression

In Svelte 4, `<svelte:element this="div">` is valid code. This makes little sense — you should just do `<div>`. In the vanishingly rare case that you _do_ need to use a literal value for some reason, you can do this:

```diff
- <svelte:element this="div">
+ <svelte:element this={"div"}>
```

Note that whereas Svelte 4 would treat `<svelte:element this="input">` (for example) identically to `<input>` for the purposes of determining which `bind:` directives could be applied, Svelte 5 does not.
