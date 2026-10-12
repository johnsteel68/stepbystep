import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RenderBoundary from "./components/RenderBoundary";
import "./index.css";

const container = document.querySelector('[data-stepbystep-root]') ?? document.getElementById("root");
const root = createRoot(container!);
const embedded = Boolean(document.querySelector('[data-stepbystep-root]'));
root.render(<RenderBoundary scope="application"><App embedded={embedded} /></RenderBoundary>);
