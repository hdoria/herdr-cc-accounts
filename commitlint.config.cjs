// Conventional Commits. A .cjs file loads the same in a CommonJS and in an ESM project.

module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        // Reads the header the same way as a plain regular expression, instead of commitlint's greedy
        // header pattern. The scope, when there is one, is a single group "([a-z0-9_.-]+)" right before
        // "!?: ", with no nested parentheses. A greedy read rejected "feat(web): calls foo(): bar", whose
        // subject holds a second "): ", while a stricter reader accepts it (scope "web", the rest is the
        // subject). The scope's character class has no "(" or ")", so it cannot cross a neighbouring
        // parenthesis. Empty parentheses ("feat(): x") do not match "+" and fail; no parentheses at all
        // leave the group out and pass.
        "scope-pattern": (/** @type {{ header?: string | null }} */ parsed) => [
          /^\w+(\([a-z0-9_.-]+\))?!?: /.test(parsed.header ?? ""),
          'the scope takes only lowercase letters, digits, "_", "." and "-" (no space, no "/"), right before ": "',
        ],
      },
    },
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // a new feature for the user
        "fix", // a bug fix
        "docs", // documentation only
        "style", // formatting, no change in behavior
        "refactor", // changes the structure, not the behavior
        "perf", // a performance improvement
        "test", // tests
        "build", // build, dependencies, packaging
        "ci", // the pipeline
        "chore", // upkeep that does not belong in a release note
        "revert", // reverts an earlier commit
      ],
    ],
    "scope-case": [2, "always", "lower-case"],
    "scope-pattern": [2, "always"],
    "subject-case": [2, "always", "lower-case"],
    "subject-full-stop": [2, "never", "."],
    "subject-empty": [2, "never"],
    "header-max-length": [2, "always", 72],
    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"],
  },
};
