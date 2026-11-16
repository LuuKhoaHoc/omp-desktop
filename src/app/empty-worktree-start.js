(function () {
  function resetForProject(state, project) {
    if (project === state.project) return state;
    return { project, branches: null, branchesProject: "", baseBranch: "", branchesLoading: false, error: "" };
  }

  function beginBranchLoad(state) {
    return { ...state, branches: null, branchesProject: "", baseBranch: "", branchesLoading: true, error: "" };
  }

  function finishBranchLoad(state, project, result) {
    if (project !== state.project) return state;
    if (!result.ok) {
      return { ...state, branches: null, branchesProject: "", branchesLoading: false, error: result.error };
    }
    return { ...state, branches: result.value, branchesProject: project, branchesLoading: false, error: "" };
  }

  function canOpen(state, newWorktree, loading) {
    if (loading || !state.project) return false;
    if (!newWorktree) return true;
    return Boolean(
      state.branchesProject === state.project && state.branches?.length &&
      state.baseBranch && !state.branchesLoading
    );
  }

  window.OMP_EMPTY_WORKTREE_START = { resetForProject, beginBranchLoad, finishBranchLoad, canOpen };
})();

