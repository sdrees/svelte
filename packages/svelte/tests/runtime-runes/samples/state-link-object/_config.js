import { flushSync } from 'svelte';
import { test } from '../../test';

export default test({
	html: `<button>0</button><button>0</button><button>0</button>`,

	test({ assert, target }) {
		const [btn1, btn2, btn3] = target.querySelectorAll('button');

		flushSync(() => btn1.click());
		assert.htmlEqual(target.innerHTML, `<button>1</button><button>1</button><button>1</button>`);

		// mutate the original object, via the link
		flushSync(() => btn2.click());
		assert.htmlEqual(target.innerHTML, `<button>2</button><button>2</button><button>2</button>`);

		// mutate the copy
		flushSync(() => btn3.click());
		assert.htmlEqual(target.innerHTML, `<button>2</button><button>2</button><button>3</button>`);

		flushSync(() => btn1.click());
		assert.htmlEqual(target.innerHTML, `<button>3</button><button>3</button><button>3</button>`);
	}
});
