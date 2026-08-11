import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "error",
      config: {
        rules: [
          { id: "landmark-one-main", enabled: false },
          { id: "page-has-heading-one", enabled: false },
          { id: "region", enabled: false },
        ],
      },
    },
    options: {
      storySort: {
        order: ["Foundations", "Components", "Workspaces"],
      },
    },
  },
};

export default preview;
