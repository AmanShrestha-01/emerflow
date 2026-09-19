import os

# The records check (DeepChart) is off in Hospital Swarm by default. Most tests exercise it on purpose,
# so turn it on for the test run; test_records_check_is_off_by_default covers the default.
os.environ.setdefault("EMERFLOW_RECORDS_CHECK", "1")
