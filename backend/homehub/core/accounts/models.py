from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    description = models.TextField(blank=True, null=True)

    def __str__(self) -> str:
        return self.username
