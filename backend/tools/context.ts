export type ToolStatusUpdate = (
  /** Message to display to the user as the status update */
  message: string,
  /** Similar to Slack Blocks - allows tools and agents to attach richer messages. Format TBD. */
  blocks?: unknown
) => void;

export type ToolContext = {
  updateStatus: ToolStatusUpdate;
};
