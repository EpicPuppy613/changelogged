import ora from "ora";

type Callback = (message: string) => void;

export async function task(
	message: string,
	run: (success: Callback, fail: Callback) => Promise<void>,
) {
	const spin = ora({
		text: message,
		spinner: "line",
	});
	spin.start();
	await run(
		(m) => spin.succeed(m),
		(m) => spin.fail(m),
	);

	if (spin.isSpinning) {
		spin.fail("Task did not return");
	}
}

export async function ftask(
	message: string,
	fail: string,
	run: (success: Callback, fail: Callback) => Promise<void>,
) {
	await task(message, async (s, f) => {
		try {
			await run(s, f);
		} catch (e) {
			const message = fail;
			f(message);
			throw new Error(message);
		}
	});
}
