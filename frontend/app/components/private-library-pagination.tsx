interface PrivateLibraryPaginationProps {
  currentPage: number;
  label: string;
  loading: boolean;
  onPageChange: (page: number) => void;
  totalPages: number;
}

export function PrivateLibraryPagination({
  currentPage,
  label,
  loading,
  onPageChange,
  totalPages,
}: PrivateLibraryPaginationProps) {
  return (
    <WorkspacePagination
      currentPage={currentPage}
      label={label}
      loading={loading}
      onPageChange={onPageChange}
      totalPages={totalPages}
    />
  );
}
import { WorkspacePagination } from "./workspace-pagination";
