# STEPbySTEP MCP

Stateless HTTP endpoint: `POST /mcp`. Sites provides authentication and the private plugin; no desktop installation or separate OAuth implementation is required. Users still need to connect the integration in their supported ChatGPT environment. This is not a public app-directory submission.

## Tools

- `list_materials`: catalogue filtered for 0–4 bends, thicknesses and stock limits.
- `create_piece`: rectangular flat or folded parts, external wing dimensions, bend angles/directions, brushing direction and round holes (5 mm default).
- `inspect_piece`: validate an existing share link.

All dimensions are millimetres; wing indices start at zero. A folded part needs `bendCount + 1` wing lengths. Invalid configurations return no share link. The existing configurator remains responsible for STEP/PDF generation. There is no purchase, price quotation, deck upload or storage of customer data.

Example `create_piece` arguments:

```json
{"bendCount":1,"finish":"steel-raw","thickness":3,"width":100,"legLengths":[100,100],"angles":[90],"directions":[1],"holes":[{"leg":0,"dist":25,"offset":25,"diameter":5}]}
```

Run `node --experimental-strip-types --test tests/mcp.test.ts`. Tests use a local identity fixture only; authentication headers in production must originate from the trusted Sites boundary. No credentials belong in source or browser code. Manufacturing checks are indicative, not certification of a load-bearing design.
