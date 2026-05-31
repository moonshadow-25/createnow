interface AppVersionBadgeProps {
  canCheckUpdate: boolean;
  onClick: () => void;
}

export function AppVersionBadge({ canCheckUpdate, onClick }: AppVersionBadgeProps) {
  const title = canCheckUpdate
    ? `点击检查更新（前端版本 ${__APP_VERSION__}）`
    : `当前前端版本 ${__APP_VERSION__}`;

  if (!canCheckUpdate) {
    return (
      <span
        className="text-xs font-mono text-gray-500 border border-gray-700 px-2 py-0.5 rounded-md"
        title={title}
      >
        v{__APP_VERSION__}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-mono text-gray-500 hover:text-blue-300 border border-gray-700 hover:border-blue-500/60 px-2 py-0.5 rounded-md transition"
      title={title}
    >
      v{__APP_VERSION__}
    </button>
  );
}
