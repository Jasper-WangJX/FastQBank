// First-time empty-state guidance for a brand-new account.
//
// Rendered by QuestionListPage when both the user's tag list and
// question list are empty (per shouldShowOnboarding). Disappears
// automatically once either becomes non-empty — no dismiss button,
// no localStorage flag, no users.onboarded_at field.

import { Plus, Tag as TagIcon, Upload } from "lucide-react";

export default function OnboardingEmpty() {
  return (
    <div className="mx-auto my-8 max-w-2xl rounded-sm border-2 border-dashed border-slate-300 bg-slate-50/50 px-6 py-8">
      <h2 className="text-lg font-semibold text-slate-900">
        Welcome to FastQBank
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Your question bank is empty. Two steps to get going:
      </p>

      <ol className="mt-4 space-y-3 text-sm text-slate-700">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[#1E3A8A] font-mono text-[11px] font-semibold text-white">
            1
          </span>
          <span>
            Create a tag —{" "}
            <span className="inline-flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700">
              <TagIcon size={11} strokeWidth={1.5} />
              Tags
            </span>{" "}
            button on the left of the toolbar.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[#1E3A8A] font-mono text-[11px] font-semibold text-white">
            2
          </span>
          <span>
            Add your first question —{" "}
            <span className="inline-flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700">
              <Plus size={11} strokeWidth={1.5} />
              New
            </span>{" "}
            tab in the top navigation.
          </span>
        </li>
      </ol>

      <p className="mt-4 text-xs text-slate-500">
        Or import a shared link via{" "}
        <span className="inline-flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          <Upload size={10} strokeWidth={1.5} />
          Import
        </span>{" "}
        in the page header.
      </p>
    </div>
  );
}
