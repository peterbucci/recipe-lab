from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any, cast
from unittest import mock

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "package_source.py"
SPEC = importlib.util.spec_from_file_location("recipe_lab_package_source", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - import system guard
    raise RuntimeError("Could not load the source packaging module.")
package_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = package_module
SPEC.loader.exec_module(package_module)


class SourcePackageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.base = Path(self.temporary_directory.name)
        self.repository = self.base / "repository"
        self.repository.mkdir()
        self._git("init", "--quiet")
        self._git("config", "user.name", "Recipe Lab Test")
        self._git("config", "user.email", "recipe-lab@example.invalid")
        self._write(".gitignore", ".env\n")
        self._write("README.md", "# Fixture\n")
        self._write("backend/app.py", "print('safe fixture')\n")
        self._commit("safe fixture")

    def _git(self, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.repository,
            check=check,
            capture_output=True,
        )

    def _write(self, relative_path: str, content: str | bytes) -> Path:
        path = self.repository / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        return path

    def _commit(self, message: str) -> str:
        self._git("add", "--all")
        self._git("commit", "--quiet", "-m", message)
        return self._git("rev-parse", "HEAD").stdout.decode("ascii").strip()

    def _output(self, name: str = "recipe-lab-source.zip") -> Path:
        output_directory = self.base / "outputs"
        output_directory.mkdir(exist_ok=True)
        return output_directory / name

    def _package(
        self,
        *,
        revision: str = "HEAD",
        output: Path | None = None,
        policy: object | None = None,
    ) -> tuple[Path, dict[str, object]]:
        destination = output or self._output()
        keyword_arguments = {}
        if policy is not None:
            keyword_arguments["policy"] = policy
        report = package_module.package_source(
            self.repository,
            revision,
            destination,
            **keyword_arguments,
        )
        return destination, report


class SuccessfulPackageTests(SourcePackageTestCase):
    def test_includes_only_the_reviewed_root_dependency_contract_files(self) -> None:
        self._write(
            ".gitattributes",
            "*.sh text eol=lf\n",
        )
        self._write(
            ".dockerignore",
            ".env*\n.git\n.venv\n",
        )
        self._write(
            "pyproject.toml",
            '[tool.uv]\nrequired-version = "==0.12.6"\n',
        )
        self._write(
            "uv.lock",
            'version = 1\nrevision = 3\nrequires-python = ">=3.12"\n',
        )
        commit_sha = self._commit("add dependency contract")

        output, report = self._package(revision=commit_sha)

        files = cast(list[dict[str, Any]], report["files"])
        self.assertEqual(
            [file_report["path"] for file_report in files],
            [
                ".dockerignore",
                ".gitattributes",
                ".gitignore",
                "README.md",
                "backend/app.py",
                "pyproject.toml",
                "uv.lock",
            ],
        )
        archive_root = f"recipe-lab-{commit_sha[:12]}"
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(
                archive.read(f"{archive_root}/.dockerignore"),
                b".env*\n.git\n.venv\n",
            )
            self.assertEqual(
                archive.read(f"{archive_root}/.gitattributes"),
                b"*.sh text eol=lf\n",
            )
            self.assertEqual(
                archive.read(f"{archive_root}/pyproject.toml"),
                b'[tool.uv]\nrequired-version = "==0.12.6"\n',
            )
            self.assertEqual(
                archive.read(f"{archive_root}/uv.lock"),
                b'version = 1\nrevision = 3\nrequires-python = ">=3.12"\n',
            )

    def test_packages_only_committed_files_and_never_reads_ignored_env(self) -> None:
        ignored_secret = "ignored_" + "SuperSensitiveValue7391"
        self._write(".env", f"CLIENT_SECRET={ignored_secret}\n")

        output, report = self._package()

        self.assertTrue(output.is_file())
        manifest_path = output.with_name(f"{output.name}.manifest.json")
        self.assertTrue(manifest_path.is_file())
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest, report)
        scanner = cast(dict[str, Any], report["scanner"])
        self.assertEqual(scanner["passes"], ["commit-tree", "completed-archive"])
        self.assertEqual(scanner["result"], "passed")
        self.assertRegex(scanner["sha256"], r"^[0-9a-f]{64}$")
        policy_report = cast(dict[str, Any], report["policy"])
        self.assertEqual(policy_report["version"], 5)
        self.assertRegex(policy_report["sha256"], r"^[0-9a-f]{64}$")
        archive_report = cast(dict[str, Any], report["archive"])
        self.assertEqual(archive_report["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(archive_report["entry_count"], 3)
        self.assertEqual(archive_report["compressed_bytes"], output.stat().st_size)
        self.assertEqual(
            archive_report["uncompressed_bytes"],
            sum(len(value) for value in (".env\n", "# Fixture\n", "print('safe fixture')\n")),
        )
        files = cast(list[dict[str, Any]], report["files"])
        self.assertEqual(
            [file_report["path"] for file_report in files],
            [".gitignore", "README.md", "backend/app.py"],
        )
        self.assertEqual(
            [file_report["size_bytes"] for file_report in files],
            [len(".env\n"), len("# Fixture\n"), len("print('safe fixture')\n")],
        )
        self.assertTrue(
            all(
                isinstance(file_report["compressed_bytes"], int)
                and file_report["compressed_bytes"] > 0
                for file_report in files
            )
        )
        with zipfile.ZipFile(output) as archive:
            names = archive.namelist()
            self.assertFalse(any(".env" in name for name in names))
            self.assertEqual(len(names), 3)
        self.assertNotIn(ignored_secret, output.read_bytes().decode("latin1"))

    def test_explicit_older_revision_uses_committed_blob_not_worktree(self) -> None:
        first_sha = self._git("rev-parse", "HEAD").stdout.decode("ascii").strip()
        self._write("README.md", "# Newer fixture\n")
        self._commit("newer fixture")

        output, report = self._package(revision=first_sha)

        source = cast(dict[str, Any], report["source"])
        self.assertEqual(source["commit_sha"], first_sha)
        member_name = f"recipe-lab-{first_sha[:12]}/README.md"
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read(member_name), b"# Fixture\n")

    def test_same_revision_produces_identical_archive_and_manifest_bytes(self) -> None:
        first_output = self.base / "first" / "source.zip"
        second_output = self.base / "second" / "source.zip"

        first_output, _ = self._package(output=first_output)
        second_output, _ = self._package(output=second_output)

        self.assertEqual(first_output.read_bytes(), second_output.read_bytes())
        self.assertEqual(
            hashlib.sha256(first_output.read_bytes()).hexdigest(),
            hashlib.sha256(second_output.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            first_output.with_name("source.zip.manifest.json").read_bytes(),
            second_output.with_name("source.zip.manifest.json").read_bytes(),
        )

    def test_preserves_executable_and_regular_modes(self) -> None:
        executable = self._write("scripts/tool.py", "#!/usr/bin/env python3\n")
        executable.chmod(0o755)
        self._git("add", "scripts/tool.py")
        self._git("update-index", "--chmod=+x", "scripts/tool.py")
        self._git("commit", "--quiet", "-m", "add executable")
        self.assertTrue(executable.exists())

        output, _ = self._package()

        with zipfile.ZipFile(output) as archive:
            member = next(item for item in archive.infolist() if item.filename.endswith("tool.py"))
            self.assertEqual((member.external_attr >> 16) & 0o777, 0o755)

    def test_packages_reviewed_shell_scripts_as_scanned_text(self) -> None:
        executable = self._write(
            "scripts/rehearsal.sh",
            "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'safe fixture\\n'\n",
        )
        executable.chmod(0o755)
        self._git("add", "scripts/rehearsal.sh")
        self._git("update-index", "--chmod=+x", "scripts/rehearsal.sh")
        self._git("commit", "--quiet", "-m", "add reviewed shell script")

        output, report = self._package()

        files = cast(list[dict[str, Any]], report["files"])
        shell_report = next(item for item in files if item["path"] == "scripts/rehearsal.sh")
        self.assertEqual(shell_report["mode"], "100755")
        scanner = cast(dict[str, Any], report["scanner"])
        self.assertEqual(scanner["text_files_scanned_per_pass"], 4)
        policy = cast(dict[str, Any], report["policy"])
        self.assertEqual(policy["reviewed_opaque_entries"], 0)
        with zipfile.ZipFile(output) as archive:
            member = next(
                item for item in archive.infolist() if item.filename.endswith("rehearsal.sh")
            )
            self.assertEqual((member.external_attr >> 16) & 0o777, 0o755)


class DirtyAndOutputGuardTests(SourcePackageTestCase):
    def test_refuses_unstaged_tracked_change_without_leaking_path(self) -> None:
        self._write("README.md", "changed\n")
        with self.assertRaisesRegex(package_module.PackagingError, "working tree is dirty"):
            self._package()

    def test_refuses_staged_change(self) -> None:
        self._write("backend/new.py", "value = 1\n")
        self._git("add", "backend/new.py")
        with self.assertRaisesRegex(package_module.PackagingError, "working tree is dirty"):
            self._package()

    def test_refuses_untracked_change(self) -> None:
        self._write("backend/untracked.py", "value = 1\n")
        with self.assertRaisesRegex(package_module.PackagingError, "working tree is dirty"):
            self._package()

    def test_refuses_output_inside_repository(self) -> None:
        output = self.repository / "source.zip"
        with self.assertRaisesRegex(package_module.PackagingError, "outside the repository"):
            self._package(output=output)
        self.assertFalse(output.exists())

    def test_refuses_existing_output_or_manifest(self) -> None:
        output = self._output()
        output.write_bytes(b"existing")
        with self.assertRaisesRegex(package_module.PackagingError, "refusing to overwrite"):
            self._package(output=output)
        self.assertEqual(output.read_bytes(), b"existing")

    def test_post_scan_failure_leaves_no_archive_or_manifest(self) -> None:
        output = self._output()
        finding = package_module.SecretFinding(rule="test-post-scan", path="backend/app.py", line=1)
        with mock.patch.object(package_module, "_scan_entries", side_effect=[[], [finding]]):
            with self.assertRaisesRegex(package_module.PackagingError, "completed-archive"):
                self._package(output=output)
        self.assertFalse(output.exists())
        self.assertFalse(output.with_name(f"{output.name}.manifest.json").exists())
        self.assertEqual(list(output.parent.glob(".*.tmp")), [])

    def test_scanner_exception_fails_closed_without_output(self) -> None:
        output = self._output()
        with mock.patch.object(
            package_module, "_scan_entries", side_effect=RuntimeError("scanner detail")
        ):
            with self.assertRaisesRegex(package_module.PackagingError, "could not be completed"):
                self._package(output=output)
        self.assertFalse(output.exists())
        self.assertFalse(output.with_name(f"{output.name}.manifest.json").exists())

    def test_concurrent_dirty_tree_change_prevents_publication(self) -> None:
        output = self._output()
        with mock.patch.object(
            package_module,
            "_require_clean_tree",
            side_effect=[
                None,
                package_module.PackagingError("working tree became dirty"),
            ],
        ):
            with self.assertRaisesRegex(package_module.PackagingError, "became dirty"):
                self._package(output=output)
        self.assertFalse(output.exists())
        self.assertFalse(output.with_name(f"{output.name}.manifest.json").exists())

    def test_cli_hides_unexpected_exception_detail(self) -> None:
        canary = "sensitive-" + "internal-canary"
        stderr = io.StringIO()
        with mock.patch.object(package_module, "package_source", side_effect=RuntimeError(canary)):
            with redirect_stderr(stderr):
                result = package_module.main(["--ref", "HEAD", "--output", str(self._output())])
        self.assertEqual(result, 1)
        self.assertNotIn(canary, stderr.getvalue())

    def test_interrupt_between_publications_removes_partial_archive(self) -> None:
        output = self._output()
        original_link = os.link
        link_calls = 0

        def interrupt_second_link(source: Path, destination: Path) -> None:
            nonlocal link_calls
            link_calls += 1
            if link_calls == 2:
                raise KeyboardInterrupt
            original_link(source, destination)

        with mock.patch.object(package_module.os, "link", side_effect=interrupt_second_link):
            with self.assertRaises(KeyboardInterrupt):
                self._package(output=output)
        self.assertFalse(output.exists())
        self.assertFalse(output.with_name(f"{output.name}.manifest.json").exists())


class RejectedTreeTests(SourcePackageTestCase):
    def _commit_and_reject(self, path: str, content: str | bytes, pattern: str) -> None:
        self._write(path, content)
        self._commit(f"add prohibited {path}")
        with self.assertRaisesRegex(package_module.PackagingError, pattern):
            self._package()

    def test_rejects_environment_file(self) -> None:
        self._commit_and_reject("backend/.env.production", "VALUE=hidden\n", "Environment file")

    def test_rejects_nested_env_example(self) -> None:
        self._commit_and_reject("backend/.env.example", "VALUE=hidden\n", "Environment file")

    def test_rejects_nested_dependency_lock(self) -> None:
        self._commit_and_reject(
            "backend/uv.lock",
            'version = 1\nrevision = 3\nrequires-python = ">=3.12"\n',
            "File type is not in the export allowlist",
        )

    def test_rejects_private_key_filename(self) -> None:
        self._commit_and_reject("backend/server.key", "not even a key\n", "not exportable")

    def test_rejects_gitmodules_metadata(self) -> None:
        self._commit_and_reject(".gitmodules", '[submodule "x"]\n', "not in the export allowlist")

    def test_rejects_dependency_cache_build_report_and_test_output_paths(self) -> None:
        cases = (
            "frontend/node_modules/module.ts",
            "frontend/bower_components/module.ts",
            "frontend/.next/page.ts",
            "frontend/.cache/state.json",
            "frontend/.turbo/state.json",
            "frontend/.output/page.ts",
            "frontend/.vercel/state.json",
            "backend/__pycache__/module.py",
            "backend/venv/module.py",
            "backend/site-packages/module.py",
            "backend/vendor/module.py",
            "backend/build/module.py",
            "backend/target/module.py",
            "ml/reports/result.json",
            "frontend/artifacts/result.json",
            "frontend/test-artifacts/result.json",
            "frontend/test-output/result.json",
            "frontend/test-results/result.json",
            "frontend/allure-results/result.json",
            "frontend/allure-report/result.json",
            "frontend/blob-report/result.json",
            "frontend/traces/result.json",
            "frontend/screenshots/result.json",
        )
        for index, path in enumerate(cases):
            with self.subTest(path=path):
                temporary = tempfile.TemporaryDirectory()
                self.addCleanup(temporary.cleanup)
                repository = Path(temporary.name) / "repo"
                repository.mkdir()
                subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True)
                subprocess.run(["git", "config", "user.name", "Test"], cwd=repository, check=True)
                subprocess.run(
                    ["git", "config", "user.email", "test@example.invalid"],
                    cwd=repository,
                    check=True,
                )
                target = repository / path
                target.parent.mkdir(parents=True)
                target.write_text(f"fixture {index}\n", encoding="utf-8")
                subprocess.run(["git", "add", "--all"], cwd=repository, check=True)
                subprocess.run(
                    ["git", "commit", "--quiet", "-m", "fixture"],
                    cwd=repository,
                    check=True,
                )
                with self.assertRaises(package_module.PackagingError):
                    package_module.package_source(
                        repository, "HEAD", Path(temporary.name) / "source.zip"
                    )

    def test_rejects_runtime_assembled_secret_without_echoing_value(self) -> None:
        secret = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
        self._write("backend/config.py", f"credential = '{secret}'\n")
        self._commit("add secret decoy")

        with self.assertRaises(package_module.PackagingError) as raised:
            self._package()

        message = str(raised.exception)
        self.assertIn("aws-access-key-id", message)
        self.assertNotIn(secret, message)

    def test_rejects_runtime_assembled_private_key_header(self) -> None:
        header = "-----BEGIN " + "PRIVATE KEY-----"
        self._write("backend/key.py", f"payload = '''{header}\nabc\n'''\n")
        self._commit("add key decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "private-key"):
            self._package()

    def test_rejects_high_entropy_generic_credential_assignment(self) -> None:
        secret = "".join(("xT7v", "R9pQ", "2nM4", "cL6s", "K8dF"))
        self._write("backend/config.py", f"CLIENT_SECRET={secret}\n")
        self._commit("add generic secret decoy")

        with self.assertRaises(package_module.PackagingError) as raised:
            self._package()

        message = str(raised.exception)
        self.assertIn("generic-credential", message)
        self.assertNotIn(secret, message)

    def test_placeholder_cannot_hide_later_secret_on_same_line(self) -> None:
        secret = "".join(("Q7mv", "R9pK", "2nZ4", "cL6s", "W8dF"))
        line = f'CLIENT_SECRET="replace-with-example"; API_TOKEN="{secret}"\n'
        self._write("backend/config.py", line)
        self._commit("add same-line secret decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "generic-credential"):
            self._package()

    def test_unquoted_placeholder_cannot_hide_later_secret(self) -> None:
        secret = "".join(("Q7mv", "R9pK", "2nZ4", "cL6s", "W8dF"))
        line = f"CLIENT_SECRET=replace-with-example; API_TOKEN={secret}\n"
        self._write("backend/config.py", line)
        self._commit("add same-line unquoted secret decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "generic-credential"):
            self._package()

    def test_rejects_exported_shell_credential(self) -> None:
        secret = "".join(("Q7mv", "R9pK", "2nZ4", "cL6s", "W8dF"))
        self._write("backend/config.py", f"export API_TOKEN={secret}\n")
        self._commit("add exported secret decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "generic-credential"):
            self._package()

    def test_rejects_lowercase_unquoted_yaml_credential(self) -> None:
        secret = "".join(("a7m2", "c9v4", "n6q8", "r3s5", "w1x0", "y2z9"))
        self._write("backend/config.yaml", f"client_secret: {secret}\n")
        self._commit("add lowercase secret decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "generic-credential"):
            self._package()

    def test_secret_substring_does_not_trigger_placeholder_exemption(self) -> None:
        secret = "".join(("Ab7Con", "testX9", "mQ2vL", "5sK8d"))
        self._write("backend/config.py", f"CLIENT_SECRET={secret}\n")
        self._commit("add substring secret decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "generic-credential"):
            self._package()

    def test_delimited_local_word_does_not_exempt_secret(self) -> None:
        secret = "".join(("Q7mv", "-local-", "R9pK", "2nZ4", "cL6s", "W8dF"))
        self._write("backend/config.py", f"CLIENT_SECRET={secret}\n")
        self._commit("add local-word secret decoy")
        with self.assertRaisesRegex(package_module.PackagingError, "generic-credential"):
            self._package()

    def test_placeholder_delimiter_inside_secret_does_not_exempt_it(self) -> None:
        secret = "".join(("Q7mv", "<", "R9pK", "2nZ4", "cL6s", "W8dF"))
        self._write("backend/config.py", f'CLIENT_SECRET="{secret}"\n')
        self._commit("add delimiter-bearing secret decoy")
        with self.assertRaises(package_module.PackagingError) as raised:
            self._package()

        message = str(raised.exception)
        self.assertIn("generic-credential", message)
        self.assertNotIn(secret, message)

    def test_credential_url_is_not_treated_as_a_placeholder(self) -> None:
        secret = "".join(("Q7mv", "R9pK", "2nZ4", "cL6s", "W8dF"))
        value = f"https://service.example.invalid/access?sig={secret}"
        self._write("backend/config.py", f'API_TOKEN="{value}"\n')
        self._commit("add URL-shaped secret decoy")
        with self.assertRaises(package_module.PackagingError) as raised:
            self._package()

        message = str(raised.exception)
        self.assertIn("generic-credential", message)
        self.assertNotIn(secret, message)

    def test_exact_runtime_placeholder_reference_is_allowed(self) -> None:
        self._write(
            "backend/config.py",
            'CLIENT_SECRET="${OIDC_CLIENT_SECRET}"\nAPI_TOKEN="{{ runtime.api_token }}"\n',
        )
        self._commit("add runtime placeholder references")

        output, _ = self._package()

        self.assertTrue(output.is_file())

    def test_reviewed_local_database_template_is_allowed(self) -> None:
        database_url = (
            "postgresql+psycopg://${POSTGRES_USER:-recipe_lab}:"
            "${POSTGRES_PASSWORD:-recipe_lab}@db:5432/${POSTGRES_DB:-recipe_lab}"
        )
        self._write("backend/config.yaml", f"DATABASE_URL: {database_url}\n")
        self._commit("add reviewed local database template")

        output, _ = self._package()

        self.assertTrue(output.is_file())

    def test_rejects_credential_bearing_database_url(self) -> None:
        secret = "".join(("Q7mv", "R9pK", "2nZ4", "cL6s", "W8dF"))
        database_url = f"postgresql://member:{secret}@db.example.invalid/recipe"
        self._write("backend/config.py", f'DATABASE_URL = "{database_url}"\n')
        self._commit("add credential URL decoy")
        with self.assertRaises(package_module.PackagingError) as raised:
            self._package()
        message = str(raised.exception)
        self.assertIn("credential-uri", message)
        self.assertNotIn(secret, message)

    def test_rejects_lfs_pointer(self) -> None:
        pointer = "\n".join(
            (
                "version https://git-lfs.github.com/spec/v1",
                "oid sha256:" + ("a" * 64),
                "size 123",
                "",
            )
        )
        self._commit_and_reject("backend/model.py", pointer, "LFS pointer")

    def test_rejects_symlink_mode_without_creating_os_symlink(self) -> None:
        blob_id = self._git("rev-parse", "HEAD:backend/app.py").stdout.decode("ascii").strip()
        self._git(
            "update-index",
            "--add",
            "--cacheinfo",
            f"120000,{blob_id},backend/link.py",
        )
        self._git("commit", "--quiet", "-m", "add symlink entry")
        commit_id = self._git("rev-parse", "HEAD").stdout.decode("ascii").strip()
        with self.assertRaisesRegex(package_module.PackagingError, "regular tracked files"):
            package_module._list_tree(self.repository, commit_id, package_module.EXPORT_POLICY)

    def test_rejects_gitlink_mode(self) -> None:
        target_commit_id = self._git("rev-parse", "HEAD").stdout.decode("ascii").strip()
        self._git(
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{target_commit_id},backend/vendor.py",
        )
        self._git("commit", "--quiet", "-m", "add gitlink entry")
        commit_id = self._git("rev-parse", "HEAD").stdout.decode("ascii").strip()
        with self.assertRaisesRegex(package_module.PackagingError, "regular tracked files"):
            package_module._list_tree(self.repository, commit_id, package_module.EXPORT_POLICY)


class OpaquePngPolicyTests(SourcePackageTestCase):
    def _policy_with_reviewed_png(
        self, path: str, object_id: str
    ) -> package_module.PackagingPolicy:
        return package_module.replace(
            package_module.EXPORT_POLICY,
            reviewed_opaque_git_objects=(
                *package_module.EXPORT_POLICY.reviewed_opaque_git_objects,
                (path, object_id),
            ),
        )

    def test_every_tracked_png_at_head_matches_one_literal_policy_object(self) -> None:
        repository = SCRIPT_PATH.parents[1]
        reviewed_entries = package_module.EXPORT_POLICY.reviewed_opaque_git_objects
        reviewed_objects = dict(reviewed_entries)
        report = package_module.audit_opaque_policy(repository, "HEAD")
        counts = cast(dict[str, int], report["counts"])

        self.assertEqual(len(reviewed_entries), len(reviewed_objects))
        self.assertEqual(list(reviewed_objects), sorted(reviewed_objects))
        self.assertTrue(
            all(not any(character in path for character in "*?[]{}") for path in reviewed_objects)
        )
        self.assertEqual(report["result"], "passed")
        self.assertEqual(report["missing"], [])
        self.assertEqual(report["mismatched"], [])
        self.assertEqual(report["stale"], [])
        self.assertGreater(counts["tracked_pngs"], 0)
        self.assertEqual(counts["tracked_pngs"], counts["reviewed_entries"])

    def test_audit_reports_missing_mismatched_and_stale_entries(self) -> None:
        exact_path = "frontend/baselines/exact.png"
        mismatch_path = "frontend/baselines/mismatch.png"
        missing_path = "frontend/baselines/missing.png"
        for path in (exact_path, mismatch_path, missing_path):
            self._write(path, b"\x89PNG\r\n\x1a\n" + path.encode("ascii"))
        commit_sha = self._commit("add audit fixtures")
        exact_object_id = (
            self._git("rev-parse", f"{commit_sha}:{exact_path}").stdout.decode("ascii").strip()
        )
        mismatch_object_id = (
            self._git("rev-parse", f"{commit_sha}:{mismatch_path}").stdout.decode("ascii").strip()
        )
        missing_object_id = (
            self._git("rev-parse", f"{commit_sha}:{missing_path}").stdout.decode("ascii").strip()
        )
        stale_path = "frontend/baselines/stale.png"
        policy = package_module.replace(
            package_module.EXPORT_POLICY,
            reviewed_opaque_git_objects=(
                (exact_path, exact_object_id),
                (mismatch_path, "a" * 40),
                (stale_path, "b" * 40),
            ),
        )

        report = package_module.audit_opaque_policy(self.repository, commit_sha, policy=policy)

        self.assertEqual(report["result"], "drift")
        self.assertEqual(
            report["counts"],
            {
                "tracked_pngs": 3,
                "reviewed_entries": 3,
                "missing": 1,
                "mismatched": 1,
                "stale": 1,
            },
        )
        self.assertEqual(
            report["missing"],
            [{"path": missing_path, "actual_object_id": missing_object_id}],
        )
        self.assertEqual(
            report["mismatched"],
            [
                {
                    "path": mismatch_path,
                    "reviewed_object_id": "a" * 40,
                    "actual_object_id": mismatch_object_id,
                }
            ],
        )
        self.assertEqual(
            report["stale"],
            [{"path": stale_path, "reviewed_object_id": "b" * 40}],
        )

    def test_audit_reads_only_the_selected_commit(self) -> None:
        policy = package_module.replace(
            package_module.EXPORT_POLICY, reviewed_opaque_git_objects=()
        )
        self._write("artifacts/local-screenshot.png", b"local disposable screenshot")
        status_before = self._git("status", "--porcelain=v1").stdout

        report = package_module.audit_opaque_policy(self.repository, "HEAD", policy=policy)

        self.assertEqual(report["result"], "passed")
        self.assertEqual(status_before, self._git("status", "--porcelain=v1").stdout)

    def test_audit_cli_returns_nonzero_for_reported_drift(self) -> None:
        report = {"result": "drift", "missing": [], "mismatched": [], "stale": []}
        stdout = io.StringIO()
        with mock.patch.object(package_module, "audit_opaque_policy", return_value=report):
            with redirect_stdout(stdout):
                result = package_module.main(["--ref", "HEAD", "--audit-opaque-policy"])

        self.assertEqual(result, 1)
        self.assertEqual(json.loads(stdout.getvalue()), report)

    def test_unreviewed_png_is_rejected(self) -> None:
        self._write("frontend/baselines/unreviewed.png", b"\x89PNG\r\n\x1a\nnew")
        self._commit("add unreviewed png")

        with self.assertRaisesRegex(package_module.PackagingError, "reviewed object"):
            self._package()

    def test_exact_reviewed_png_blob_is_exported(self) -> None:
        path = "frontend/baselines/test-reviewed.png"
        contents = b"\x89PNG\r\n\x1a\nreviewed fixture"
        self._write(path, contents)
        commit_id = self._commit("add reviewed png")
        object_id = self._git("rev-parse", f"{commit_id}:{path}").stdout.decode("ascii").strip()
        policy = self._policy_with_reviewed_png(path, object_id)

        output, report = self._package(revision=commit_id, policy=policy)

        policy_report = cast(dict[str, Any], report["policy"])
        self.assertEqual(policy_report["reviewed_opaque_entries"], 1)
        archive_root = f"recipe-lab-{commit_id[:12]}"
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read(f"{archive_root}/{path}"), contents)

    def test_changed_reviewed_png_blob_is_rejected(self) -> None:
        path = "frontend/baselines/test-reviewed.png"
        self._write(path, b"\x89PNG\r\n\x1a\nfirst reviewed fixture")
        first_commit = self._commit("add first reviewed png")
        reviewed_object_id = (
            self._git("rev-parse", f"{first_commit}:{path}").stdout.decode("ascii").strip()
        )
        self._write(path, b"\x89PNG\r\n\x1a\nchanged fixture")
        changed_commit = self._commit("change reviewed png")
        policy = self._policy_with_reviewed_png(path, reviewed_object_id)

        with self.assertRaisesRegex(package_module.PackagingError, "reviewed object"):
            self._package(revision=changed_commit, policy=policy)

    def test_wildcard_cannot_authorize_pngs(self) -> None:
        wildcard_policy = self._policy_with_reviewed_png("frontend/baselines/**/*.png", "a" * 40)

        with self.assertRaisesRegex(package_module.PackagingError, "literal paths"):
            self._package(policy=wildcard_policy)


class LimitAndPathTests(SourcePackageTestCase):
    def test_path_validator_rejects_portability_decoys(self) -> None:
        invalid_paths = (
            "/backend/app.py",
            "../backend/app.py",
            "backend/../app.py",
            "C:/backend/app.py",
            "backend\\app.py",
            "backend/con.py",
            "backend/trailing. ",
            "backend/evil\u202ep.py",
            "unknown/app.py",
        )
        for path in invalid_paths:
            with self.subTest(path=path):
                with self.assertRaises(package_module.PackagingError):
                    package_module._validate_source_path(path, package_module.EXPORT_POLICY)

    def test_casefold_collision_is_rejected(self) -> None:
        object_id = b"a" * 40
        raw_tree = (
            b"100644 blob "
            + object_id
            + b" 1\tbackend/Case.py\0"
            + b"100644 blob "
            + object_id
            + b" 1\tbackend/case.py\0"
        )
        with mock.patch.object(package_module, "_run_git", return_value=raw_tree):
            with self.assertRaisesRegex(package_module.PackagingError, "path"):
                package_module._list_tree(self.repository, "a" * 40, package_module.EXPORT_POLICY)

    def test_entry_count_limit_is_enforced(self) -> None:
        policy = package_module.replace(package_module.EXPORT_POLICY, max_entries=2)
        with self.assertRaisesRegex(package_module.PackagingError, "entry-count"):
            self._package(policy=policy)

    def test_complete_archive_path_limit_is_enforced(self) -> None:
        policy = package_module.replace(package_module.EXPORT_POLICY, max_path_bytes=32)
        with self.assertRaisesRegex(package_module.PackagingError, "Archive path"):
            self._package(policy=policy)

    def test_file_and_uncompressed_limits_are_enforced(self) -> None:
        with self.subTest(limit="file"):
            policy = package_module.replace(package_module.EXPORT_POLICY, max_file_bytes=5)
            with self.assertRaisesRegex(package_module.PackagingError, "file exceeds"):
                self._package(policy=policy)
        with self.subTest(limit="total"):
            policy = package_module.replace(
                package_module.EXPORT_POLICY,
                max_uncompressed_bytes=10,
                max_file_bytes=10,
            )
            with self.assertRaisesRegex(package_module.PackagingError, "uncompressed-size"):
                self._package(policy=policy)

    def test_compressed_limit_is_enforced_without_partial_output(self) -> None:
        output = self._output()
        policy = package_module.replace(package_module.EXPORT_POLICY, max_compressed_bytes=10)
        with self.assertRaisesRegex(package_module.PackagingError, "compressed-size"):
            self._package(output=output, policy=policy)
        self.assertFalse(output.exists())

    def test_archive_inspection_rejects_traversal_extra_and_symlink_members(
        self,
    ) -> None:
        destination = self._output("malicious.zip")
        destination.parent.mkdir(exist_ok=True)
        member = zipfile.ZipInfo("../escape.py", date_time=package_module.FIXED_ZIP_TIMESTAMP)
        member.create_system = 3
        member.external_attr = (0o100644 & 0xFFFF) << 16
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr(member, b"bad")
        with self.assertRaisesRegex(package_module.PackagingError, "entry count|unexpected path"):
            package_module._verify_completed_archive(
                destination,
                "a" * 40,
                [],
                package_module.EXPORT_POLICY,
            )


if __name__ == "__main__":
    unittest.main()
