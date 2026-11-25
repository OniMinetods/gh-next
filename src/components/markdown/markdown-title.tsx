import { clsx } from "~/lib/shared/utils.shared";

export type MarkdownTitleProps = {
  title: string;
  className?: string;
};

export function MarkdownTitle({ title, className }: MarkdownTitleProps) {
  return (
    <span className={clsx("font-normal", className)}>
      {title.split(/`([^`\r\n]*?)`/).map((text, index) =>
        index % 2 === 0 ? (
          text
        ) : (
          <code key={index} className="rounded-md bg-neutral px-1.5 py-1">
            {text}
          </code>
        )
      )}
    </span>
  );
}
