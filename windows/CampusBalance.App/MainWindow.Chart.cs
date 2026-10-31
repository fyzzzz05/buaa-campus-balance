using System.Globalization;
using CampusBalance.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace CampusBalance.App;

// 图表与统计：对应 dashboard.html 的 .chart / .grid / .axis / .bar / .lp / .dot / .tip / .stats。
public sealed partial class MainWindow
{
    private readonly List<DayValue> chartDays = new();
    private readonly List<Point> chartPlot = new();
    private readonly Dictionary<int, Rectangle> chartBarMap = new();
    private readonly Dictionary<int, Ellipse> chartDotMap = new();
    private string chartUnit = "元";

    private int SelectedIndex => Math.Clamp(selectedMetric, 0, readings.Count - 1);

    private void RenderPanel(bool animate)
    {
        var reading = readings[SelectedIndex];
        MetricTitle.Text = reading.Name;
        HistoryNote.Text = string.IsNullOrEmpty(reading.HistoryNote)
            ? (string.IsNullOrEmpty(reading.Note) ? "近 14 天" : reading.Note)
            : reading.HistoryNote;
        Reauthenticate.Visibility = reading.Status == ReadingStatus.LoginRequired ? Visibility.Visible : Visibility.Collapsed;

        chartDays.Clear();
        if (reading.History is { Count: > 0 } history)
            chartDays.AddRange(history.TakeLast(14));
        else
            chartDays.AddRange(CampusDates.Recent().Select(day => new DayValue(day, null)));

        chartUnit = reading.Unit;
        var values = chartDays.Where(p => p.Value is >= 0).Select(p => p.Value!.Value).ToArray();
        SumLabel.Text = values.Length == chartDays.Count ? "14 天合计" : "已记录合计";
        SetStat(Sum, SumUnit, values.Length > 0 ? values.Sum() : null, reading.Unit);
        SetStat(Average, AverageUnit, values.Length > 0 ? values.Sum() / values.Length : null, reading.Unit);
        SetStat(Maximum, MaximumUnit, values.Length > 0 ? values.Max() : null, reading.Unit);

        RenderChart(animate);
        if (animate) AnimateTitleRise();
    }

    private void SetStat(TextBlock number, TextBlock unit, decimal? value, string unitText)
    {
        number.Text = value is { } shown ? shown.ToString("0.00", CultureInfo.InvariantCulture) : "—";
        unit.Text = unitText;
        unit.Visibility = value is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private void AnimateTitleRise()
    {
        if (ReduceMotion) return;
        if (TitleGroup.RenderTransform is not TranslateTransform transform)
        {
            transform = new TranslateTransform();
            TitleGroup.RenderTransform = transform;
        }
        Animate(TitleGroup, "Opacity", 0, 1, TimeSpan.FromMilliseconds(450));
        Animate(transform, "Y", 8, 0, TimeSpan.FromMilliseconds(450));
    }

    private static double NiceMax(double value)
    {
        if (value <= 0) return 1;
        var raw = value * 1.08;
        var power = Math.Pow(10, Math.Floor(Math.Log10(raw)));
        foreach (var candidate in new[] { 1d, 2, 4, 8, 10 })
            if (candidate * power >= raw) return candidate * power;
        return 10 * power;
    }

    private void RenderChart(bool animate)
    {
        var hostWidth = ChartHost.ActualWidth;
        var hostHeight = ChartHost.ActualHeight;
        ChartCanvas.Children.Clear();
        ChartOverlay.Children.Clear();
        ChartOverlay.Children.Add(ChartTooltip);
        chartBarMap.Clear();
        chartDotMap.Clear();
        chartPlot.Clear();
        ChartTooltip.Visibility = Visibility.Collapsed;

        var reading = readings[SelectedIndex];
        var valid = chartDays.Where(p => p.Value is >= 0).Select(p => (double)p.Value!.Value).ToArray();
        EmptyChart.Text = reading.Status == ReadingStatus.Loading ? "正在查询"
            : reading.Status != ReadingStatus.Ok ? (string.IsNullOrEmpty(reading.Note) ? "暂时无法查询" : reading.Note)
            : "暂无可展示的数据";
        EmptyChart.Visibility = valid.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (chartDays.Count == 0 || hostWidth < 80 || hostHeight < 40) return;

        ChartCanvas.Width = hostWidth;
        ChartCanvas.Height = hostHeight;
        ChartCanvas.Clip = new RectangleGeometry { Rect = new Rect(0, 0, hostWidth, hostHeight) };
        ChartOverlay.Width = hostWidth;
        ChartOverlay.Height = hostHeight;

        var left = hostWidth < 300 ? 29d : 40d;
        const double right = 8, top = 10, bottom = 26;
        var plotWidth = Math.Max(1, hostWidth - left - right);
        var plotHeight = Math.Max(1, hostHeight - top - bottom);
        var slot = plotWidth / chartDays.Count;
        var maximum = NiceMax(valid.Length > 0 ? valid.Max() : 0);
        var lineBrush = LineBrush;
        var mutedBrush = MutedBrush;
        var baseline = top + plotHeight;

        for (var j = 0; j <= 4; j++)
        {
            var y = baseline - plotHeight * j / 4.0;
            var grid = new Rectangle { Width = plotWidth, Height = 1, Fill = lineBrush };
            Canvas.SetLeft(grid, left);
            Canvas.SetTop(grid, y);
            ChartCanvas.Children.Add(grid);
            var label = new TextBlock
            {
                Text = maximum < 10 ? (maximum * j / 4).ToString("0.#", CultureInfo.InvariantCulture)
                                    : (maximum * j / 4).ToString("0", CultureInfo.InvariantCulture),
                FontSize = 11,
                Width = left - 8,
                TextAlignment = TextAlignment.Right,
                Foreground = mutedBrush,
            };
            Canvas.SetLeft(label, 0);
            Canvas.SetTop(label, y - 7);
            ChartCanvas.Children.Add(label);
        }

        var step = hostWidth < 350 ? 4 : 2;
        for (var i = 0; i < chartDays.Count; i++)
        {
            var day = chartDays[i];
            var cx = left + slot * (i + 0.5);
            var value = day.Value is { } shown && shown >= 0 ? (double)shown : double.NaN;
            var cy = double.IsNaN(value) ? double.NaN : baseline - value / maximum * plotHeight;
            chartPlot.Add(new Point(cx, cy));
            if ((chartDays.Count - 1 - i) % step != 0) continue;
            var label = new TextBlock
            {
                Text = day.Date.Length >= 10 ? day.Date[5..].Replace('-', '/') : day.Date,
                FontSize = 11,
                Width = 44,
                TextAlignment = TextAlignment.Center,
                Foreground = mutedBrush,
            };
            Canvas.SetLeft(label, cx - 22);
            Canvas.SetTop(label, hostHeight - 20);
            ChartCanvas.Children.Add(label);
        }

        if (!lineMode) DrawBars(animate, slot, baseline);
        else DrawLines(animate, baseline);

        AutomationProperties.SetName(ChartCanvas, MetricTitle.Text + "，" + string.Join("；",
            chartDays.Select(day => day.Date + "：" + (day.Value is { } shown && shown >= 0
                ? shown.ToString("0.00", CultureInfo.InvariantCulture) + " " + chartUnit
                : "暂无数据"))));
    }

    private void DrawBars(bool animate, double slot, double baseline)
    {
        for (var i = 0; i < chartDays.Count; i++)
        {
            if (double.IsNaN(chartPlot[i].Y)) continue;
            var cx = chartPlot[i].X;
            var barWidth = Math.Min(28, slot * 0.56);
            var height = Math.Max(1, baseline - chartPlot[i].Y);
            var bar = new Rectangle
            {
                Width = barWidth,
                Height = height,
                Fill = AccentBrush,
                Opacity = i == chartDays.Count - 1 ? 1 : 0.45,
                RadiusX = 4,
                RadiusY = 4,
            };
            Canvas.SetLeft(bar, cx - barWidth / 2);
            Canvas.SetTop(bar, chartPlot[i].Y);
            chartBarMap[i] = bar;
            ChartCanvas.Children.Add(bar);
            if (!animate || ReduceMotion) continue;
            var scale = new ScaleTransform { ScaleX = 1, ScaleY = 0, CenterX = barWidth / 2, CenterY = height };
            bar.RenderTransform = scale;
            var grow = new DoubleAnimation
            {
                From = 0,
                To = 1,
                Duration = new Duration(TimeSpan.FromMilliseconds(520)),
                BeginTime = TimeSpan.FromMilliseconds(Math.Min(i * 15, 180)),
                EasingFunction = EaseOut,
                FillBehavior = FillBehavior.Stop,
            };
            Storyboard.SetTarget(grow, scale);
            Storyboard.SetTargetProperty(grow, "ScaleY");
            var storyboard = new Storyboard();
            storyboard.Children.Add(grow);
            storyboard.Completed += (_, _) => scale.ScaleY = 1;
            storyboard.Begin();
        }
    }

    private void DrawLines(bool animate, double baseline)
    {
        var chunks = new List<List<int>>();
        List<int>? current = null;
        for (var i = 0; i < chartDays.Count; i++)
        {
            if (double.IsNaN(chartPlot[i].Y)) { current = null; continue; }
            if (current is null) { current = new List<int>(); chunks.Add(current); }
            current.Add(i);
        }

        var accentBrush = AccentBrush;
        var panelBrush = PanelBrush;
        var accentColor = AccentColor;
        foreach (var chunk in chunks)
        {
            foreach (var index in chunk)
            {
                var dot = new Ellipse
                {
                    Width = 9,
                    Height = 9,
                    Fill = panelBrush,
                    Stroke = accentBrush,
                    StrokeThickness = 2,
                    Opacity = 0,
                };
                Canvas.SetLeft(dot, chartPlot[index].X - 4.5);
                Canvas.SetTop(dot, chartPlot[index].Y - 4.5);
                chartDotMap[index] = dot;
                ChartCanvas.Children.Add(dot);
            }
            if (chunk.Count == 1)
            {
                var single = new Ellipse { Width = 6, Height = 6, Fill = accentBrush };
                Canvas.SetLeft(single, chartPlot[chunk[0]].X - 3);
                Canvas.SetTop(single, chartPlot[chunk[0]].Y - 3);
                ChartCanvas.Children.Add(single);
                continue;
            }

            var lineFigure = new PathFigure { StartPoint = chartPlot[chunk[0]], IsClosed = false, IsFilled = false };
            var areaFigure = new PathFigure { StartPoint = chartPlot[chunk[0]], IsClosed = true, IsFilled = true };
            for (var i = 1; i < chunk.Count; i++)
            {
                var previous = chartPlot[chunk[i - 1]];
                var point = chartPlot[chunk[i]];
                var mid = (previous.X + point.X) / 2;
                var segment = new BezierSegment
                {
                    Point1 = new Point(mid, previous.Y),
                    Point2 = new Point(mid, point.Y),
                    Point3 = point,
                };
                lineFigure.Segments.Add(segment);
                areaFigure.Segments.Add(new BezierSegment
                {
                    Point1 = new Point(mid, previous.Y),
                    Point2 = new Point(mid, point.Y),
                    Point3 = point,
                });
            }
            areaFigure.Segments.Add(new LineSegment { Point = new Point(chartPlot[chunk[^1]].X, baseline) });
            areaFigure.Segments.Add(new LineSegment { Point = new Point(chartPlot[chunk[0]].X, baseline) });

            var lineGeometry = new PathGeometry();
            lineGeometry.Figures.Add(lineFigure);
            var areaGeometry = new PathGeometry();
            areaGeometry.Figures.Add(areaFigure);
            var gradient = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
            gradient.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(64, accentColor.R, accentColor.G, accentColor.B) });
            gradient.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(0, accentColor.R, accentColor.G, accentColor.B) });

            var area = new Microsoft.UI.Xaml.Shapes.Path { Data = areaGeometry, Fill = gradient };
            if (animate && !ReduceMotion)
            {
                area.Opacity = 0;
                var fade = new DoubleAnimation
                {
                    From = 0,
                    To = 1,
                    Duration = new Duration(TimeSpan.FromMilliseconds(400)),
                    EasingFunction = EaseOut,
                    FillBehavior = FillBehavior.Stop,
                };
                Storyboard.SetTarget(fade, area);
                Storyboard.SetTargetProperty(fade, "Opacity");
                var fadeStoryboard = new Storyboard();
                fadeStoryboard.Children.Add(fade);
                fadeStoryboard.Completed += (_, _) => area.Opacity = 1;
                fadeStoryboard.Begin();
            }
            ChartCanvas.Children.Add(area);

            var line = new Microsoft.UI.Xaml.Shapes.Path
            {
                Data = lineGeometry,
                Stroke = accentBrush,
                StrokeThickness = 2.5,
                StrokeLineJoin = PenLineJoin.Round,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
            };
            ChartCanvas.Children.Add(line);
            if (animate && !ReduceMotion) AnimateLineDraw(line, chunk);
        }
    }

    private void AnimateLineDraw(Microsoft.UI.Xaml.Shapes.Path line, List<int> chunk)
    {
        var length = 0d;
        for (var i = 1; i < chunk.Count; i++)
        {
            var a = chartPlot[chunk[i - 1]];
            var b = chartPlot[chunk[i]];
            length += Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
        }
        if (length < 1) return;
        var unit = length / 2.5;
        line.StrokeDashArray = new DoubleCollection { unit, unit };
        line.StrokeDashOffset = unit;
        var draw = new DoubleAnimation
        {
            From = unit,
            To = 0,
            Duration = new Duration(TimeSpan.FromMilliseconds(750)),
            EasingFunction = EaseOut,
            FillBehavior = FillBehavior.Stop,
        };
        Storyboard.SetTarget(draw, line);
        Storyboard.SetTargetProperty(draw, "StrokeDashOffset");
        var storyboard = new Storyboard();
        storyboard.Children.Add(draw);
        storyboard.Completed += (_, _) =>
        {
            line.StrokeDashArray = null;
            line.StrokeDashOffset = 0;
        };
        storyboard.Begin();
    }

    // ===================== 悬停提示（dashboard.html 的 .tip 与 .bar.on / .dot.on） =====================

    private void ChartHost_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (chartPlot.Count == 0) return;
        var x = e.GetCurrentPoint(ChartHost).Position.X;
        var nearest = 0;
        var bestDistance = double.MaxValue;
        for (var i = 0; i < chartPlot.Count; i++)
        {
            var distance = Math.Abs(chartPlot[i].X - x);
            if (distance >= bestDistance) continue;
            bestDistance = distance;
            nearest = i;
        }
        HighlightChart(nearest, showTooltip: true);
    }

    private void ClearChartHover()
    {
        ChartTooltip.Visibility = Visibility.Collapsed;
        if (chartPlot.Count > 0) HighlightChart(chartPlot.Count - 1, showTooltip: false);
    }

    private void HighlightChart(int index, bool showTooltip)
    {
        foreach (var pair in chartBarMap) pair.Value.Opacity = pair.Key == index ? 1 : 0.45;
        foreach (var pair in chartDotMap) pair.Value.Opacity = pair.Key == index ? 1 : 0;
        if (!showTooltip || index < 0 || index >= chartDays.Count) { ChartTooltip.Visibility = Visibility.Collapsed; return; }
        var day = chartDays[index];
        var shown = day.Value is { } value && value >= 0 ? value : (decimal?)null;
        ChartTooltipText.Text = day.Date + "  " + (shown is { } text
            ? text.ToString("0.00", CultureInfo.InvariantCulture) + " " + chartUnit
            : "暂无数据");
        ChartTooltip.Visibility = Visibility.Visible;
        ChartTooltip.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var size = ChartTooltip.DesiredSize;
        var x = chartPlot[index].X;
        var y = double.IsNaN(chartPlot[index].Y) ? ChartHost.ActualHeight - 26 : Math.Max(20, chartPlot[index].Y);
        var limit = Math.Max(48, ChartHost.ActualWidth - 48);
        x = Math.Clamp(x, 48, limit);
        Canvas.SetLeft(ChartTooltip, x - size.Width / 2);
        Canvas.SetTop(ChartTooltip, y - 12 - size.Height);
    }
}
