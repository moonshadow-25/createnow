import { useState, useRef, useEffect, useCallback } from 'react';

interface ExpandableTextProps {
  text: string;
  maxLines?: number;
  className?: string;
}

export function ExpandableText({ text, maxLines = 2, className = '' }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflow, setIsOverflow] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (expanded) {
      setIsOverflow(true);
      return;
    }
    setIsOverflow(el.scrollHeight > el.clientHeight);
  }, [text, expanded, maxLines]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  return (
    <div>
      <div
        ref={textRef}
        className={`${className} ${expanded ? '' : `line-clamp-${maxLines}`}`}
      >
        {text}
      </div>
      {isOverflow && (
        <span
          onClick={handleToggle}
          className="text-blue-400 hover:text-blue-300 text-xs mt-0.5 cursor-pointer select-none"
        >
          {expanded ? '收起 ▲' : '展开 ▼'}
        </span>
      )}
    </div>
  );
}
