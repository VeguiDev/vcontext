## Design system

Before changing UI, layout, styling, animation, content hierarchy, or visual
assets, read [DESIGN.md](./DESIGN.md) completely. Treat it as the source of
truth for the landing's tokens and component language.

If an intentional change modifies the design system, update `DESIGN.md` in the
same change. Do not introduce one-off colors, spacing values, breakpoints, or
component patterns without documenting the decision there.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
- [Using the Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
