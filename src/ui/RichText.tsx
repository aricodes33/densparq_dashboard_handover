import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

/** Rich-text editor (Tiptap). Stores HTML; the backend must sanitise on write (allow-list: p, h3, strong, em, ul, ol, li, a). */
export function RichText({ value, onChange, label, readOnly }: { value: string; onChange: (html: string) => void; label: string; readOnly?: boolean }) {
  const ed = useEditor({ extensions: [StarterKit.configure({ heading: { levels: [3] } })], content: value, editable: !readOnly,
    editorProps: { attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true', class: 'prose' } },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()) });
  useEffect(() => { if (ed && value !== ed.getHTML() && !ed.isFocused) ed.commands.setContent(value || ''); }, [value, ed]);
  useEffect(() => { ed?.setEditable(!readOnly); }, [readOnly, ed]);
  if (!ed) return null;
  const B = (l: string, name: string, on: boolean, run: () => void) => <button type="button" aria-label={name} aria-pressed={on} className={on ? 'on' : ''} onClick={run}>{l}</button>;
  return <div className="editor">
    {!readOnly && <div className="tb" role="toolbar" aria-label={`${label} formatting`}>
      {B('B', 'Bold', ed.isActive('bold'), () => ed.chain().focus().toggleBold().run())}{B('I', 'Italic', ed.isActive('italic'), () => ed.chain().focus().toggleItalic().run())}
      {B('H', 'Heading', ed.isActive('heading'), () => ed.chain().focus().toggleHeading({ level: 3 }).run())}{B('•', 'Bulleted list', ed.isActive('bulletList'), () => ed.chain().focus().toggleBulletList().run())}{B('1.', 'Numbered list', ed.isActive('orderedList'), () => ed.chain().focus().toggleOrderedList().run())}
    </div>}
    <EditorContent editor={ed} />
  </div>;
}
