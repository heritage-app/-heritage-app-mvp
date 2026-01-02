import { format, formatDistanceToNow } from "date-fns";

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "No date";

  try {
    const date = new Date(dateString);
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return "Invalid date";
  }
}

export function formatDateAbsolute(dateString: string | null | undefined): string {
  if (!dateString) return "No date";

  try {
    const date = new Date(dateString);
    return format(date, "PPp");
  } catch {
    return "Invalid date";
  }
}

