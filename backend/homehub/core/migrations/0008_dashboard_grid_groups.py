from django.db import migrations, models
import django.db.models.deletion


def seed_dashboard_grid(apps, schema_editor):
    DashboardCard = apps.get_model("core", "DashboardCard")
    cards = list(DashboardCard.objects.all().order_by("order", "id"))
    for index, card in enumerate(cards):
        card.grid_w = 4
        card.grid_h = 3
        card.grid_x = (index % 3) * 4
        card.grid_y = (index // 3) * 3
        card.save(
            update_fields=[
                "grid_x",
                "grid_y",
                "grid_w",
                "grid_h",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0007_expand_floorplan_object_types"),
    ]

    operations = [
        migrations.CreateModel(
            name="DashboardGroup",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.CharField(max_length=100)),
                ("order", models.PositiveIntegerField(default=0)),
            ],
            options={"ordering": ["order", "id"]},
        ),
        migrations.AddField(
            model_name="dashboardcard",
            name="grid_h",
            field=models.PositiveSmallIntegerField(default=3),
        ),
        migrations.AddField(
            model_name="dashboardcard",
            name="grid_w",
            field=models.PositiveSmallIntegerField(default=4),
        ),
        migrations.AddField(
            model_name="dashboardcard",
            name="grid_x",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="dashboardcard",
            name="grid_y",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="dashboardcard",
            name="group",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="cards",
                to="core.dashboardgroup",
            ),
        ),
        migrations.AlterModelOptions(
            name="dashboardcard",
            options={
                "ordering": [
                    "group_id",
                    "grid_y",
                    "grid_x",
                    "order",
                    "id",
                ]
            },
        ),
        migrations.RunPython(seed_dashboard_grid, migrations.RunPython.noop),
    ]
