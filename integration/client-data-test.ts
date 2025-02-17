import { test, expect } from "@playwright/test";

import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import type { AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

function getFiles({
  parentClientLoader,
  parentClientLoaderHydrate,
  parentAdditions,
  childClientLoader,
  childClientLoaderHydrate,
  childAdditions,
}: {
  parentClientLoader: boolean;
  parentClientLoaderHydrate: boolean;
  parentAdditions?: string;
  childClientLoader: boolean;
  childClientLoaderHydrate: boolean;
  childAdditions?: string;
}) {
  return {
    "app/root.tsx": js`
      import { Outlet, Scripts } from '@remix-run/react'

      export default function Root() {
        return (
          <html>
            <head></head>
            <body>
              <main>
                <Outlet />
              </main>
              <Scripts />
            </body>
          </html>
        );
      }
    `,
    "app/routes/_index.tsx": js`
      import { Link } from '@remix-run/react'
      export default function Component() {
        return <Link to="/parent/child">Go to /parent/child</Link>
      }
    `,
    "app/routes/parent.tsx": js`
      import { json } from '@remix-run/node'
      import { Outlet, useLoaderData } from '@remix-run/react'
      export function loader() {
        return json({ message: 'Parent Server Loader'});
      }
      ${
        parentClientLoader
          ? js`
              export async function clientLoader({ serverLoader }) {
                // Need a small delay to ensure we capture the server-rendered
                // fallbacks for assertions
                await new Promise(r => setTimeout(r, 100))
                let data = await serverLoader();
                return { message: data.message + " (mutated by client)" };
              }
            `
          : ""
      }
      ${
        parentClientLoaderHydrate
          ? js`
              clientLoader.hydrate = true;
              export function HydrateFallback() {
                return <p>Parent Fallback</p>
              }
            `
          : ""
      }
      ${parentAdditions || ""}
      export default function Component() {
        let data = useLoaderData();
        return (
          <>
            <p id="parent-data">{data.message}</p>
            <Outlet/>
          </>
        );
      }
    `,
    "app/routes/parent.child.tsx": js`
      import { json } from '@remix-run/node'
      import { Form, Outlet, useActionData, useLoaderData } from '@remix-run/react'
      export function loader() {
        return json({ message: 'Child Server Loader'});
      }
      export function action() {
        return json({ message: 'Child Server Action'});
      }
      ${
        childClientLoader
          ? js`
              export async function clientLoader({ serverLoader }) {
                // Need a small delay to ensure we capture the server-rendered
                // fallbacks for assertions
                await new Promise(r => setTimeout(r, 100))
                let data = await serverLoader();
                return { message: data.message + " (mutated by client)" };
              }
            `
          : ""
      }
      ${
        childClientLoaderHydrate
          ? js`
              clientLoader.hydrate = true;
              export function HydrateFallback() {
                return <p>Child Fallback</p>
              }
            `
          : ""
      }
      ${childAdditions || ""}
      export default function Component() {
        let data = useLoaderData();
        let actionData = useActionData();
        return (
          <>
            <p id="child-data">{data.message}</p>
            <Form method="post">
              <button type="submit">Submit</button>
              {actionData ? <p id="child-action-data">{actionData.message}</p> : null}
            </Form>
          </>
        );
      }
    `,
  };
}

test.describe("Client Data", () => {
  let appFixture: AppFixture;

  test.afterAll(() => {
    appFixture.close();
  });

  test.describe("clientLoader - critical route module", () => {
    test("no client loaders or fallbacks", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      // Full SSR - normal Remix behavior due to lack of clientLoader
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
    });

    test("parent.clientLoader/child.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      // Full SSR - normal Remix behavior due to lack of HydrateFallback components
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
    });

    test("parent.clientLoader.hydrate/child.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: true,
            childClientLoader: true,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Fallback");
      expect(html).not.toMatch("Parent Server Loader");
      expect(html).not.toMatch("Child Server Loader");

      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).not.toMatch("Parent Fallback");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader");
    });

    test("parent.clientLoader/child.clientLoader.hydrate", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: true,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Fallback");
      expect(html).not.toMatch("Child Server Loader");

      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).not.toMatch("Child Fallback");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader (mutated by client)");
    });

    test("parent.clientLoader.hydrate/child.clientLoader.hydrate", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: true,
            childClientLoader: true,
            childClientLoaderHydrate: true,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Fallback");
      expect(html).not.toMatch("Parent Server Loader");
      expect(html).not.toMatch("Child Fallback");
      expect(html).not.toMatch("Child Server Loader");

      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).not.toMatch("Parent Fallback");
      expect(html).not.toMatch("Child Fallback");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader (mutated by client)");
    });

    test("handles synchronous client loaders", async ({ page }) => {
      let fixture = await createFixture({
        files: getFiles({
          parentClientLoader: false,
          parentClientLoaderHydrate: false,
          childClientLoader: false,
          childClientLoaderHydrate: false,
          parentAdditions: js`
            export function clientLoader() {
              return { message: "Parent Client Loader" };
            }
            clientLoader.hydrate=true
            export function HydrateFallback() {
              return <p>Parent Fallback</p>
            }
          `,
          childAdditions: js`
            export function clientLoader() {
              return { message: "Child Client Loader" };
            }
            clientLoader.hydrate=true
        `,
        }),
      });

      // Ensure we SSR the fallbacks
      let doc = await fixture.requestDocument("/parent/child");
      let html = await doc.text();
      expect(html).toMatch("Parent Fallback");

      appFixture = await createAppFixture(fixture);
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Client Loader");
      expect(html).toMatch("Child Client Loader");
    });

    test("handles deferred data through client loaders", async ({ page }) => {
      let fixture = await createFixture({
        files: {
          ...getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
          }),
          "app/routes/parent.child.tsx": js`
            import * as React from 'react';
            import { defer, json } from '@remix-run/node'
            import { Await, useLoaderData } from '@remix-run/react'
            export function loader() {
              return defer({
                message: 'Child Server Loader',
                lazy: new Promise(r => setTimeout(() => r("Child Deferred Data"), 1000)),
              });
            }
            export async function clientLoader({ serverLoader }) {
              let data = await serverLoader();
              return {
                ...data,
                message: data.message + " (mutated by client)",
              };
            }
            clientLoader.hydrate = true;
            export function HydrateFallback() {
              return <p>Child Fallback</p>
            }
            export default function Component() {
              let data = useLoaderData();
              return (
                <>
                  <p id="child-data">{data.message}</p>
                  <React.Suspense fallback={<p>Loading Deferred Data...</p>}>
                    <Await resolve={data.lazy}>
                      {(value) => <p id="child-deferred-data">{value}</p>}
                    </Await>
                  </React.Suspense>
                </>
              );
            }
          `,
        },
      });

      // Ensure initial document request contains the child fallback _and_ the
      // subsequent streamed/resolved deferred data
      let doc = await fixture.requestDocument("/parent/child");
      let html = await doc.text();
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Fallback");
      expect(html).toMatch("Child Deferred Data");

      appFixture = await createAppFixture(fixture);
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      await page.waitForSelector("#child-deferred-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      // app.goto() doesn't resolve until the document finishes loading so by
      // then the HTML has updated via the streamed suspense updates
      expect(html).toMatch("Child Server Loader (mutated by client)");
      expect(html).toMatch("Child Deferred Data");
    });

    test("allows hydration execution without rendering a fallback", async ({
      page,
    }) => {
      let fixture = await createFixture({
        files: getFiles({
          parentClientLoader: false,
          parentClientLoaderHydrate: false,
          childClientLoader: false,
          childClientLoaderHydrate: false,
          childAdditions: js`
            export async function clientLoader() {
              await new Promise(r => setTimeout(r, 100));
              return { message: "Child Client Loader" };
            }
            clientLoader.hydrate=true
        `,
        }),
      });

      appFixture = await createAppFixture(fixture);
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Child Server Loader");
      await page.waitForSelector(':has-text("Child Client Loader")');
      html = await app.getHtml("main");
      expect(html).toMatch("Child Client Loader");
    });

    test("HydrateFallback is not rendered if clientLoader.hydrate is not set (w/server loader)", async ({
      page,
    }) => {
      let fixture = await createFixture({
        files: {
          ...getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
          }),
          "app/routes/parent.child.tsx": js`
            import * as React from 'react';
            import { json } from '@remix-run/node';
            import { useLoaderData } from '@remix-run/react';
            export function loader() {
              return json({
                message: "Child Server Loader Data",
              });
            }
            export async function clientLoader({ serverLoader }) {
              await new Promise(r => setTimeout(r, 100));
              return {
                message: "Child Client Loader Data",
              };
            }
            export function HydrateFallback() {
              return <p>SHOULD NOT SEE ME</p>
            }
            export default function Component() {
              let data = useLoaderData();
              return <p id="child-data">{data.message}</p>;
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      // Ensure initial document request contains the child fallback _and_ the
      // subsequent streamed/resolved deferred data
      let doc = await fixture.requestDocument("/parent/child");
      let html = await doc.text();
      expect(html).toMatch("Child Server Loader Data");
      expect(html).not.toMatch("SHOULD NOT SEE ME");

      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Child Server Loader Data");
    });

    test("clientLoader.hydrate is automatically implied when no server loader exists (w HydrateFallback)", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { useLoaderData } from '@remix-run/react';
              // Even without setting hydrate=true, this should run on hydration
              export async function clientLoader({ serverLoader }) {
                await new Promise(r => setTimeout(r, 100));
                return {
                  message: "Loader Data (clientLoader only)",
                };
              }
              export function HydrateFallback() {
                return <p>Child Fallback</p>
              }
              export default function Component() {
                let data = useLoaderData();
                return <p id="child-data">{data.message}</p>;
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Child Fallback");
      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Loader Data (clientLoader only)");
    });

    test("clientLoader.hydrate is automatically implied when no server loader exists (w/o HydrateFallback)", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { useLoaderData } from '@remix-run/react';
              // Even without setting hydrate=true, this should run on hydration
              export async function clientLoader({ serverLoader }) {
                await new Promise(r => setTimeout(r, 100));
                return {
                  message: "Loader Data (clientLoader only)",
                };
              }
              export default function Component() {
                let data = useLoaderData();
                return <p id="child-data">{data.message}</p>;
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      let html = await app.getHtml();
      expect(html).toMatch(
        "💿 Hey developer 👋. You can provide a way better UX than this"
      );
      expect(html).not.toMatch("child-data");
      await page.waitForSelector("#child-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Loader Data (clientLoader only)");
    });

    test("throws a 400 if you call serverLoader without a server loader", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { useLoaderData, useRouteError } from '@remix-run/react';
              export async function clientLoader({ serverLoader }) {
                return await serverLoader();
              }
              export default function Component() {
                return <p>Child</p>;
              }
              export function HydrateFallback() {
                return <p>Loading...</p>;
              }
              export function ErrorBoundary() {
                let error = useRouteError();
                return <p id="child-error">{error.status} {error.data}</p>;
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      await page.waitForSelector("#child-error");
      let html = await app.getHtml("#child-error");
      expect(html.replace(/\n/g, " ").replace(/ +/g, " ")).toMatch(
        "400 Error: You are trying to call serverLoader() on a route that does " +
          'not have a server loader (routeId: "routes/parent.child")'
      );
    });

    test("initial hydration data check functions properly", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { json } from '@remix-run/node';
              import { useLoaderData, useRevalidator } from '@remix-run/react';
              let isFirstCall = true;
              export async function loader({ serverLoader }) {
                if (isFirstCall) {
                  isFirstCall = false
                  return json({
                    message: "Child Server Loader Data (1)",
                  });
                }
                return json({
                  message: "Child Server Loader Data (2+)",
                });
              }
              export async function clientLoader({ serverLoader }) {
                await new Promise(r => setTimeout(r, 100));
                let serverData = await serverLoader();
                return {
                  message: serverData.message + " (mutated by client)",
                };
              }
              clientLoader.hydrate=true;
              export default function Component() {
                let data = useLoaderData();
                let revalidator = useRevalidator();
                return (
                  <>
                    <p id="child-data">{data.message}</p>
                    <button onClick={() => revalidator.revalidate()}>Revalidate</button>
                  </>
                );
              }
              export function HydrateFallback() {
                return <p>Loading...</p>
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      await page.waitForSelector("#child-data");
      let html = await app.getHtml();
      expect(html).toMatch("Child Server Loader Data (1) (mutated by client)");
      app.clickElement("button");
      await page.waitForSelector(':has-text("Child Server Loader Data (2+)")');
      html = await app.getHtml("main");
      expect(html).toMatch("Child Server Loader Data (2+) (mutated by client)");
    });

    test("initial hydration data check functions properly even if serverLoader isn't called on hydration", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { json } from '@remix-run/node';
              import { useLoaderData, useRevalidator } from '@remix-run/react';
              let isFirstCall = true;
              export async function loader({ serverLoader }) {
                if (isFirstCall) {
                  isFirstCall = false
                  return json({
                    message: "Child Server Loader Data (1)",
                  });
                }
                return json({
                  message: "Child Server Loader Data (2+)",
                });
              }
              let isFirstClientCall = true;
              export async function clientLoader({ serverLoader }) {
                await new Promise(r => setTimeout(r, 100));
                if (isFirstClientCall) {
                  isFirstClientCall = false;
                  // First time through - don't even call serverLoader
                  return {
                    message: "Child Client Loader Data",
                  };
                }
                // Only call the serverLoader on subsequent calls and this
                // should *not* return us the initialData any longer
                let serverData = await serverLoader();
                return {
                  message: serverData.message + " (mutated by client)",
                };
              }
              clientLoader.hydrate=true;
              export default function Component() {
                let data = useLoaderData();
                let revalidator = useRevalidator();
                return (
                  <>
                    <p id="child-data">{data.message}</p>
                    <button onClick={() => revalidator.revalidate()}>Revalidate</button>
                  </>
                );
              }
              export function HydrateFallback() {
                return <p>Loading...</p>
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/parent/child");
      await page.waitForSelector("#child-data");
      let html = await app.getHtml();
      expect(html).toMatch("Child Client Loader Data");
      app.clickElement("button");
      await page.waitForSelector(':has-text("Child Server Loader Data (2+)")');
      html = await app.getHtml("main");
      expect(html).toMatch("Child Server Loader Data (2+) (mutated by client)");
    });
  });

  test.describe("clientLoader - lazy route module", () => {
    test("no client loaders or fallbacks", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");

      // Normal Remix behavior due to lack of clientLoader
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
    });

    test("parent.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");

      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader");
    });

    test("child.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");

      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader (mutated by client)");
    });

    test("parent.clientLoader/child.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");

      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader (mutated by client");
    });

    test("throws a 400 if you call serverLoader without a server loader", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { useLoaderData, useRouteError } from '@remix-run/react';
              export async function clientLoader({ serverLoader }) {
                return await serverLoader();
              }
              export default function Component() {
                return <p>Child</p>;
              }
              export function HydrateFallback() {
                return <p>Loading...</p>;
              }
              export function ErrorBoundary() {
                let error = useRouteError();
                return <p id="child-error">{error.status} {error.data}</p>;
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);

      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-error");
      let html = await app.getHtml("#child-error");
      expect(html.replace(/\n/g, " ").replace(/ +/g, " ")).toMatch(
        "400 Error: You are trying to call serverLoader() on a route that does " +
          'not have a server loader (routeId: "routes/parent.child")'
      );
    });
  });

  test.describe("clientAction - critical route module", () => {
    test("child.clientAction", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("child.clientAction/parent.childLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");

      await page.waitForSelector(
        ':has-text("Parent Server Loader (mutated by client)")'
      );
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("child.clientAction/child.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");

      await page.waitForSelector(
        ':has-text("Child Server Loader (mutated by client)")'
      );
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("child.clientAction/parent.childLoader/child.clientLoader", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Action (mutated by client)");

      await page.waitForSelector(
        ':has-text("Child Server Loader (mutated by client)")'
      );
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("throws a 400 if you call serverAction without a server action", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { json } from '@remix-run/node';
              import { Form, useRouteError } from '@remix-run/react';
              export async function clientAction({ serverAction }) {
                return await serverAction();
              }
              export default function Component() {
                return (
                  <Form method="post">
                    <button type="submit">Submit</button>
                  </Form>
                );
              }
              export function ErrorBoundary() {
                let error = useRouteError();
                return <p id="child-error">{error.status} {error.data}</p>;
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-error");
      let html = await app.getHtml("#child-error");
      expect(html.replace(/\n/g, " ").replace(/ +/g, " ")).toMatch(
        "400 Error: You are trying to call serverAction() on a route that does " +
          'not have a server action (routeId: "routes/parent.child")'
      );
    });
  });

  test.describe("clientAction - lazy route module", () => {
    test("child.clientAction", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("child.clientAction/parent.childLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: false,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");

      await page.waitForSelector(
        ':has-text("Parent Server Loader (mutated by client)")'
      );
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("child.clientAction/child.clientLoader", async ({ page }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: false,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Loader");
      expect(html).toMatch("Child Server Action (mutated by client)");

      await page.waitForSelector(
        ':has-text("Child Server Loader (mutated by client)")'
      );
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("child.clientAction/parent.childLoader/child.clientLoader", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: getFiles({
            parentClientLoader: true,
            parentClientLoaderHydrate: false,
            childClientLoader: true,
            childClientLoaderHydrate: false,
            childAdditions: js`
              export async function clientAction({ serverAction }) {
                let data = await serverAction();
                return {
                  message: data.message + " (mutated by client)"
                }
              }
            `,
          }),
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.clickLink("/parent/child");
      await page.waitForSelector("#child-data");
      let html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader");
      expect(html).toMatch("Child Server Loader");
      expect(html).not.toMatch("Child Server Action");

      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-action-data");
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Loader"); // still revalidating
      expect(html).toMatch("Child Server Action (mutated by client)");

      await page.waitForSelector(
        ':has-text("Child Server Loader (mutated by client)")'
      );
      html = await app.getHtml("main");
      expect(html).toMatch("Parent Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Loader (mutated by client)");
      expect(html).toMatch("Child Server Action (mutated by client)");
    });

    test("throws a 400 if you call serverAction without a server action", async ({
      page,
    }) => {
      appFixture = await createAppFixture(
        await createFixture({
          files: {
            ...getFiles({
              parentClientLoader: false,
              parentClientLoaderHydrate: false,
              childClientLoader: false,
              childClientLoaderHydrate: false,
            }),
            "app/routes/parent.child.tsx": js`
              import * as React from 'react';
              import { json } from '@remix-run/node';
              import { Form, useRouteError } from '@remix-run/react';
              export async function clientAction({ serverAction }) {
                return await serverAction();
              }
              export default function Component() {
                return (
                  <Form method="post">
                    <button type="submit">Submit</button>
                  </Form>
                );
              }
              export function ErrorBoundary() {
                let error = useRouteError();
                return <p id="child-error">{error.status} {error.data}</p>;
              }
            `,
          },
        })
      );
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await app.goto("/parent/child");
      await page.waitForSelector("form");
      app.clickSubmitButton("/parent/child");
      await page.waitForSelector("#child-error");
      let html = await app.getHtml("#child-error");
      expect(html.replace(/\n/g, " ").replace(/ +/g, " ")).toMatch(
        "400 Error: You are trying to call serverAction() on a route that does " +
          'not have a server action (routeId: "routes/parent.child")'
      );
    });
  });
});
