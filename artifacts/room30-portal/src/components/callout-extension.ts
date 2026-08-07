import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (emoji?: string) => ReturnType;
      toggleCallout: (emoji?: string) => ReturnType;
      unsetCallout: () => ReturnType;
      updateCalloutEmoji: (emoji: string) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => el.getAttribute("data-emoji") || "💡",
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout="true"]',
        // Only treat the .callout-content child as the editable content; this
        // stops the rendered .callout-emoji sibling from being re-absorbed as
        // content on round-trip (which was duplicating the emoji on every save).
        contentElement: (node) => {
          if (!(node instanceof HTMLElement)) return node as HTMLElement;
          const inner = node.querySelector(".callout-content");
          return (inner as HTMLElement) || (node as HTMLElement);
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "true",
        class: "callout",
      }),
      [
        "div",
        { class: "callout-emoji", contenteditable: "false" },
        node.attrs.emoji || "💡",
      ],
      ["div", { class: "callout-content" }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (emoji = "💡") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { emoji }),
      toggleCallout:
        (emoji = "💡") =>
        ({ commands, editor }) => {
          if (editor.isActive(this.name)) {
            return commands.lift(this.name);
          }
          return commands.wrapIn(this.name, { emoji });
        },
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
      updateCalloutEmoji:
        (emoji: string) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { emoji }),
    };
  },
});
