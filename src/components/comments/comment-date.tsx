const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC"
});

export function CommentDate({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {dateFormat.format(date)} UTC
    </time>
  );
}
