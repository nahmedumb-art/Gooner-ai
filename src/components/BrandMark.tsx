import React from "react";

interface BrandMarkProps {
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ className = "w-6 h-6" }) => {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="24"
        height="24"
        rx="6"
        className="fill-slate-900 dark:fill-slate-100"
      />
      <path
        d="M18.5 10.5C17.3 9.2 15.6 8.5 13.75 8.5C10.3 8.5 7.5 11.2 7.5 14.5C7.5 17.8 10.3 20.5 13.75 20.5C16.85 20.5 19.35 18.35 19.85 15.5H14.25V13.25H21.75V14.5C21.75 19.1 18.2 22.75 13.75 22.75C9.05 22.75 5.25 19.05 5.25 14.5C5.25 9.95 9.05 6.25 13.75 6.25C16.25 6.25 18.5 7.25 20.1 8.9L18.5 10.5Z"
        className="fill-white dark:fill-slate-900"
      />
      <rect
        x="18.25"
        y="6.25"
        width="3.5"
        height="3.5"
        rx="1"
        className="fill-blue-500"
      />
    </svg>
  );
};
