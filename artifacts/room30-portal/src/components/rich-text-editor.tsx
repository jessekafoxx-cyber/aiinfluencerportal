import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useCallback, useRef, useState } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  Quote,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
  Code,
  Strikethrough,
  Upload,
  Loader2,
  Lightbulb,
} from "lucide-react";
import { Callout } from "./callout-extension";

interface RichTextEditorProps {
  content: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
}

function ToolbarButton({
  onClick,
  isActive,
  icon: Icon,
  title,
  disabled,
}: {
  onClick: () => void;
  isActive?: boolean;
  icon: any;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors ${
        disabled
          ? "text-white/45 cursor-not-allowed"
          : isActive
          ? "bg-[#C9A44C]/20 text-[#C9A44C]"
          : "text-white/65 hover:text-white/70 hover:bg-white/[0.06]"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

async function uploadImageFile(file: File): Promise<string> {
  const { getAuthHeaders } = await import("@/lib/api");
  const authHeaders = await getAuthHeaders();
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch("/api/portal/admin/upload-image", {
    method: "POST",
    credentials: "include",
    headers: { ...authHeaders },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  const data = await res.json();
  return data.url;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function RichTextEditor({ content, onChange, editable = true, placeholder }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Image.configure({
        HTMLAttributes: { class: "rounded-lg max-w-full" },
      }),
      Link.configure({
        openOnClick: !editable,
        HTMLAttributes: {
          class: "text-[#C9A44C] underline underline-offset-2 hover:text-[#C9A44C]/80",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder || "Start writing your notes...",
      }),
      Callout,
    ],
    content: content || "",
    editable,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "tiptap outline-none min-h-[200px]",
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files?.length) return false;
        const files = Array.from(event.dataTransfer.files).filter(isImageFile);
        if (!files.length) return false;
        event.preventDefault();
        handleFilesUpload(files);
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith("image/")) {
            const file = items[i].getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (!imageFiles.length) return false;
        event.preventDefault();
        handleFilesUpload(imageFiles);
        return true;
      },
    },
  });

  const handleFilesUpload = useCallback(async (files: File[]) => {
    if (!editor) return;
    setUploading(true);
    try {
      for (const file of files) {
        const url = await uploadImageFile(file);
        editor.chain().focus().setImage({ src: url }).run();
      }
    } catch (err: any) {
      alert(err.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  }, [editor]);

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  const addImageFromFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isImageFile);
    if (files.length) {
      await handleFilesUpload(files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [handleFilesUpload]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("Enter URL:", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-[#0d0d0d]">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-white/[0.06] bg-[#0a0a0a]">
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive("bold")} icon={Bold} title="Bold" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive("italic")} icon={Italic} title="Italic" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive("strike")} icon={Strikethrough} title="Strikethrough" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} isActive={editor.isActive("code")} icon={Code} title="Code" />
          <div className="w-px h-5 bg-white/[0.08] mx-1" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive("heading", { level: 2 })} icon={Heading2} title="Heading 2" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor.isActive("heading", { level: 3 })} icon={Heading3} title="Heading 3" />
          <div className="w-px h-5 bg-white/[0.08] mx-1" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive("bulletList")} icon={List} title="Bullet List" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive("orderedList")} icon={ListOrdered} title="Ordered List" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive("blockquote")} icon={Quote} title="Quote" />
          <ToolbarButton
            onClick={() => {
              if (editor.isActive("callout")) {
                const next = window.prompt("Callout emoji (leave empty to remove):", editor.getAttributes("callout").emoji || "💡");
                if (next === null) return;
                if (next.trim() === "") {
                  editor.chain().focus().unsetCallout().run();
                } else {
                  editor.chain().focus().updateCalloutEmoji(next.trim()).run();
                }
              } else {
                const emoji = window.prompt("Callout emoji:", "💡");
                if (emoji === null) return;
                editor.chain().focus().setCallout(emoji.trim() || "💡").run();
              }
            }}
            isActive={editor.isActive("callout")}
            icon={Lightbulb}
            title="Callout"
          />
          <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} icon={Minus} title="Divider" />
          <div className="w-px h-5 bg-white/[0.08] mx-1" />
          <ToolbarButton onClick={addLink} isActive={editor.isActive("link")} icon={LinkIcon} title="Link" />
          <ToolbarButton onClick={addImageFromFile} icon={uploading ? Loader2 : Upload} title="Upload Image" disabled={uploading} />
          <div className="w-px h-5 bg-white/[0.08] mx-1" />
          <ToolbarButton onClick={() => editor.chain().focus().undo().run()} icon={Undo} title="Undo" />
          <ToolbarButton onClick={() => editor.chain().focus().redo().run()} icon={Redo} title="Redo" />
          {uploading && (
            <span className="text-[11px] text-[#C9A44C] ml-2 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Uploading...
            </span>
          )}
        </div>
      )}
      <div className="px-5 py-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export function RichTextViewer({ content }: { content: string }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Image.configure({ HTMLAttributes: { class: "rounded-lg max-w-full" } }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: "text-[#C9A44C] underline underline-offset-2 hover:text-[#C9A44C]/80",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      Callout,
    ],
    content: content || "",
    editable: false,
    editorProps: {
      attributes: {
        class: "tiptap outline-none",
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="px-1">
      <EditorContent editor={editor} />
    </div>
  );
}
