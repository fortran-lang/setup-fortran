program openmp_test
    use omp_lib
    implicit none

    integer :: n_threads

    !$omp parallel
    !$omp master
    n_threads = omp_get_num_threads()
    print *, "OpenMP Test: Running with", n_threads, "threads."
    !$omp end master
    !$omp end parallel

    if (n_threads <= 0) then
        print *, "OpenMP Test: FAILED (No threads detected)"
        stop 3
    end if

    print *, "OpenMP Test: OK"
end
