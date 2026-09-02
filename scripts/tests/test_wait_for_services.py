from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import wait_for_services as readiness


class ServiceReadinessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.pid_file = Path(self.temporary.name) / "service.pid"
        self.pid_file.write_text("123\n", encoding="ascii")
        self.service = readiness.Service(
            "backend", "http://127.0.0.1:8000/api/health", self.pid_file
        )

    def test_parses_loopback_service_without_splitting_url_port(self) -> None:
        service = readiness.parse_service(
            f"backend=http://127.0.0.1:8000/api/health,{self.pid_file}"
        )

        self.assertEqual(service, self.service)

    def test_waits_for_observable_readiness_without_fixed_delay(self) -> None:
        clock = iter((0.0, 0.0, 0.5))
        attempts = iter((False, True))
        sleeps: list[float] = []

        readiness.wait_for_services(
            [self.service],
            timeout_seconds=5,
            monotonic=lambda: next(clock),
            sleep=sleeps.append,
            is_running=lambda pid: pid == 123,
            is_ready=lambda url: next(attempts),
        )

        self.assertEqual(sleeps, [1.0])

    def test_fails_immediately_if_the_managed_process_stops(self) -> None:
        with self.assertRaisesRegex(readiness.ServiceReadinessError, "stopped"):
            readiness.wait_for_services(
                [self.service],
                timeout_seconds=5,
                monotonic=lambda: 0.0,
                sleep=lambda _: None,
                is_running=lambda _: False,
                is_ready=lambda _: False,
            )

    def test_timeout_names_only_services_that_are_not_ready(self) -> None:
        oidc_pid = Path(self.temporary.name) / "oidc.pid"
        oidc_pid.write_text("456\n", encoding="ascii")
        oidc = readiness.Service(
            "identity provider", "http://127.0.0.1:8200/health", oidc_pid
        )
        clock = iter((0.0, 1.0))

        with self.assertRaisesRegex(
            readiness.ServiceReadinessError, "identity provider"
        ) as caught:
            readiness.wait_for_services(
                [self.service, oidc],
                timeout_seconds=1,
                monotonic=lambda: next(clock),
                sleep=lambda _: None,
                is_running=lambda _: True,
                is_ready=lambda url: url.endswith("/api/health"),
            )

        self.assertNotIn("deadline: backend", str(caught.exception))

    def test_rejects_missing_or_nonpositive_process_identifiers(self) -> None:
        self.pid_file.write_text("0\n", encoding="ascii")

        with self.assertRaisesRegex(readiness.ServiceReadinessError, "identifier"):
            readiness.wait_for_services(
                [self.service], timeout_seconds=1, sleep=lambda _: None
            )


if __name__ == "__main__":
    unittest.main()
